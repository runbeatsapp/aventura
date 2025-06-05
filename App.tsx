
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Chat } from '@google/genai';
import { StoryTurn } from './types';
import { GEMINI_MODEL_TEXT, SYSTEM_PROMPT, INITIAL_USER_PROMPT, IMG_PROMPT_REGEX } from './constants';
import { getAiClient, generateImageForPrompt } from './services/geminiService';
import PlayerActionBar from './components/PlayerActionBar';
import StoryLog from './components/StoryLog';
import LoadingIndicator from './components/LoadingIndicator';
import ErrorMessage from './components/ErrorMessage';

const App: React.FC = () => {
  const [storyLog, setStoryLog] = useState<StoryTurn[]>([]);
  const [chat, setChat] = useState<Chat | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true); // True initially for game setup
  const [error, setError] = useState<string | null>(null);
  const [currentAIGeneratedText, setCurrentAIGeneratedText] = useState<string>("");

  const storyEndRef = useRef<null | HTMLDivElement>(null);

  const scrollToBottom = () => {
    storyEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [storyLog, currentAIGeneratedText]);

  const parseResponse = (text: string): { storyText: string; imagePrompt: string | null } => {
    const match = text.match(IMG_PROMPT_REGEX);
    if (match && match[1]) {
      const storyText = text.replace(IMG_PROMPT_REGEX, '').trim();
      return { storyText, imagePrompt: match[1].trim() };
    }
    return { storyText: text.trim(), imagePrompt: null };
  };
  
  const fetchImageForTurn = useCallback(async (turnId: string, prompt: string) => {
    setStoryLog(prevLog =>
      prevLog.map(turn =>
        turn.id === turnId ? { ...turn, isLoadingImage: true } : turn
      )
    );
    try {
      const aiInstance = getAiClient(); // Ensures API key is checked
      const imageUrl = await generateImageForPrompt(aiInstance, prompt);
      setStoryLog(prevLog =>
        prevLog.map(turn =>
          turn.id === turnId
            ? { ...turn, imageUrl, isLoadingImage: false }
            : turn
        )
      );
    } catch (e) {
      console.error("Error generando imagen:", e);
      const errorMessage = e instanceof Error ? e.message : String(e);
      setStoryLog(prevLog =>
        prevLog.map(turn =>
          turn.id === turnId ? { ...turn, isLoadingImage: false, imageError: `Error al generar imagen: ${errorMessage}` } : turn
        )
      );
      // Optionally set a general error as well, or let the turn-specific error suffice
      // setError(`Error al generar imagen para la escena: ${errorMessage}`);
    }
  }, []);


  const processAIResponseStream = useCallback(async (stream: AsyncIterable<any>, turnId: string) => {
    let fullText = "";
    setCurrentAIGeneratedText(""); // Clear previous streaming text

    for await (const chunk of stream) {
      const chunkText = chunk.text;
      if (typeof chunkText === 'string') {
        fullText += chunkText;
        setCurrentAIGeneratedText(prev => prev + chunkText);
      }
    }
    
    const { storyText, imagePrompt } = parseResponse(fullText);
    
    const modelTurn: StoryTurn = {
      id: turnId,
      speaker: 'model',
      text: storyText,
      imagePrompt: imagePrompt || undefined,
      isLoadingImage: !!imagePrompt,
    };

    setStoryLog(prevLog => {
      // If a partial model turn was added for streaming, replace it. Otherwise, add new.
      const existingTurnIndex = prevLog.findIndex(t => t.id === turnId && t.speaker === 'model_streaming');
      if (existingTurnIndex !== -1) {
        const updatedLog = [...prevLog];
        updatedLog[existingTurnIndex] = modelTurn;
        return updatedLog;
      }
      // This case should ideally not happen if we wait for full stream before adding to storyLog from now on
      return [...prevLog, modelTurn]; 
    });

    setCurrentAIGeneratedText(""); // Clear after processing

    if (imagePrompt) {
      await fetchImageForTurn(turnId, imagePrompt);
    }
  }, [fetchImageForTurn]);


  const initializeGame = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const aiInstance = getAiClient();
      const newChat = aiInstance.chats.create({
        model: GEMINI_MODEL_TEXT,
        config: { systemInstruction: SYSTEM_PROMPT },
      });
      setChat(newChat);

      const turnId = crypto.randomUUID();
      // Add a placeholder for the model's response while streaming
      setStoryLog([{ 
        id: turnId, 
        speaker: 'model_streaming', // Special type for streaming UI
        text: '', // Will be filled by setCurrentAIGeneratedText
      }]);

      const stream = await newChat.sendMessageStream({ message: INITIAL_USER_PROMPT });
      await processAIResponseStream(stream, turnId);

    } catch (e) {
      console.error("Error inicializando el juego:", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processAIResponseStream]); // SYSTEM_PROMPT, GEMINI_MODEL_TEXT, INITIAL_USER_PROMPT are constants

  useEffect(() => {
    initializeGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Runs once on mount


  const handlePlayerSubmit = async (inputText: string) => {
    if (!chat || isLoading || !inputText.trim()) return;

    setIsLoading(true);
    setError(null);

    const userTurn: StoryTurn = {
      id: crypto.randomUUID(),
      speaker: 'user',
      text: inputText,
    };
    
    const modelResponseTurnId = crypto.randomUUID();
    
    setStoryLog(prevLog => [...prevLog, userTurn, {
      id: modelResponseTurnId,
      speaker: 'model_streaming',
      text: '',
    }]);

    try {
      const stream = await chat.sendMessageStream({ message: inputText });
      await processAIResponseStream(stream, modelResponseTurnId);
    } catch (e) {
      console.error("Error enviando mensaje:", e);
      setError(e instanceof Error ? e.message : String(e));
      // Remove the streaming placeholder if an error occurs
      setStoryLog(prevLog => prevLog.filter(turn => turn.id !== modelResponseTurnId));
    } finally {
      setIsLoading(false);
    }
  };
  
  if (isLoading && storyLog.length === 0 && !error) {
     return <LoadingIndicator message="Cargando aventura..." fullScreen={true} />;
  }

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto p-4">
      <header className="mb-6 text-center">
        <h1 className="text-4xl font-bold text-purple-400 tracking-tight">Aventura de Texto Dinámica</h1>
        <p className="text-lg text-gray-400 mt-1">Tu historia te espera...</p>
      </header>
      
      {error && !error.includes("API_KEY no configurada") && <ErrorMessage message={error} onDismiss={() => setError(null)} />}
      {error && error.includes("API_KEY no configurada") && (
        <div className="bg-red-800 border border-red-600 text-white px-4 py-3 rounded-lg relative mb-4" role="alert">
          <strong className="font-bold">Error Crítico:</strong>
          <span className="block sm:inline"> {error} Por favor, asegúrate de que la variable de entorno API_KEY está configurada correctamente.</span>
        </div>
      )}


      <StoryLog storyLog={storyLog} currentAIText={currentAIGeneratedText} />
      
      <PlayerActionBar onSubmit={handlePlayerSubmit} isLoading={isLoading} />
      <div ref={storyEndRef} />
    </div>
  );
};

export default App;
