export interface VoiceItem {
  id: string; // voice_id or unique identifier
  name: string; // voices/voice_id or identifier
  displayName: string; // Local nickname or remote display_name
  type: 'replicated' | 'preset' | 'prompted';
  originalName?: string;
  createTime?: string;
  sampleAudioUrl?: string; // Data URL or local path for playback preview
  tags?: string[];
  isFavorite?: boolean;
  description?: string;
}

export interface CloneVoicePayload {
  displayName: string;
  sourceAudioBase64: string; // 24kHz mono 16-bit PCM WAV base64
  consentAudioBase64: string; // 24kHz mono 16-bit PCM WAV base64
  store?: boolean;
  tags?: string[];
}

export interface DirectorResult {
  enhancedText: string;
  targetLanguage: string;
  speechStyle: string;
  directorNotes: string;
}

export interface SynthesizePayload {
  text: string;
  voiceId: string;
  stylePrompt?: string;
  model?: 'gemini-3.8-flash-tts' | 'gemini-3.8-flash-lite-tts';
}

export interface GenerationRecord {
  id: string;
  timestamp: number;
  text: string;
  voiceId: string;
  voiceName: string;
  stylePrompt: string;
  audioBase64: string;
  audioDuration: number;
  model: string;
}

export interface AppSettings {
  apiKey: string;
  proxyUrl: string;
  autoPlay: boolean;
  defaultModel: 'gemini-3.8-flash-tts' | 'gemini-3.8-flash-lite-tts';
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}
