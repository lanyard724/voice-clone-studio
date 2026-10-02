import { useState, useRef, useEffect, useCallback } from 'react';
import { convertBlobTo24kWav } from '../utils/audioConverter';

export interface RecorderState {
  isRecording: boolean;
  isPaused: boolean;
  isConverting: boolean;
  duration: number;
  volume: number; // 0 to 1
  audioBlob: Blob | null;
  audioBase64: string | null;
  dataUrl: string | null;
  error: string | null;
}

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanupAudio = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, [cleanupAudio]);

  const updateVolume = useCallback(() => {
    if (!analyserRef.current || !isRecording || isPaused) return;

    const dataArray = new Uint8Array(new ArrayBuffer(analyserRef.current.frequencyBinCount));
    analyserRef.current.getByteFrequencyData(dataArray as any);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const avg = sum / dataArray.length;
    // Map average (0 to 255) to 0 to 1
    const normalized = Math.min(1, avg / 128);
    setVolume(normalized);

    animationFrameRef.current = requestAnimationFrame(updateVolume);
  }, [isRecording, isPaused]);

  const startRecording = useCallback(async () => {
    setError(null);
    audioChunksRef.current = [];
    setDuration(0);
    setAudioBlob(null);
    setAudioBase64(null);
    setDataUrl(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      streamRef.current = stream;

      // Web Audio for volume metering
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      // Use native supported mimeType
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        setIsConverting(true);
        const rawBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        try {
          // Standardize to 24kHz mono 16-bit PCM WAV
          const converted = await convertBlobTo24kWav(rawBlob);
          const wavBlob = new Blob([converted.arrayBuffer], { type: 'audio/wav' });
          setAudioBlob(wavBlob);
          setAudioBase64(converted.base64);
          setDataUrl(converted.dataUrl);
          setDuration(converted.duration);
        } catch (convErr) {
          console.error('Audio standardization failed', convErr);
          setError(`音频标准化转码失败: ${convErr instanceof Error ? convErr.message : String(convErr)}`);
        } finally {
          setIsConverting(false);
          cleanupAudio();
        }
      };

      recorder.start(100);
      setIsRecording(true);
      setIsPaused(false);

      // Start duration timer
      const startTime = Date.now();
      timerRef.current = window.setInterval(() => {
        setDuration(Math.floor((Date.now() - startTime) / 1000));
      }, 500);

      // Start volume meter
      animationFrameRef.current = requestAnimationFrame(updateVolume);
    } catch (err) {
      console.error('Failed to access microphone', err);
      setError('无法访问麦克风，请检查录音设备权限');
      cleanupAudio();
    }
  }, [cleanupAudio, updateVolume]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      setIsConverting(true);
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      setVolume(0);
    }
  }, [isRecording]);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording && !isPaused) {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
    }
  }, [isRecording, isPaused]);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording && isPaused) {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      animationFrameRef.current = requestAnimationFrame(updateVolume);
    }
  }, [isRecording, isPaused, updateVolume]);

  const resetRecording = useCallback(() => {
    cleanupAudio();
    setIsRecording(false);
    setIsPaused(false);
    setIsConverting(false);
    setDuration(0);
    setVolume(0);
    setAudioBlob(null);
    setAudioBase64(null);
    setDataUrl(null);
    setError(null);
  }, [cleanupAudio]);

  /**
   * Directly import an existing local file and standardize to 24kHz PCM WAV
   */
  const loadFileAudio = useCallback(async (file: File) => {
    setError(null);
    setIsConverting(true);
    try {
      const converted = await convertBlobTo24kWav(file);
      const wavBlob = new Blob([converted.arrayBuffer], { type: 'audio/wav' });
      setAudioBlob(wavBlob);
      setAudioBase64(converted.base64);
      setDataUrl(converted.dataUrl);
      setDuration(converted.duration);
      return converted;
    } catch (err) {
      console.error('Failed to load and convert audio file', err);
      setError(`文件解析失败: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      setIsConverting(false);
    }
  }, []);

  return {
    isRecording,
    isPaused,
    isConverting,
    duration,
    volume,
    audioBlob,
    audioBase64,
    dataUrl,
    error,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    resetRecording,
    loadFileAudio
  };
}
