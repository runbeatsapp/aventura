
export interface StoryTurn {
  id: string;
  speaker: 'user' | 'model' | 'model_streaming'; // 'model_streaming' for live updates
  text: string;
  imageUrl?: string;
  imagePrompt?: string;
  isLoadingImage?: boolean;
  imageError?: string;
}
