import { useRef, useState, useEffect, ChangeEvent } from 'react';
import { Mic, Square, Upload, Play, Pause, Trash2, CheckCircle2, Loader2 } from 'lucide-react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { formatAudioTime } from '../utils/audioConverter';

interface AudioRecorderProps {
  label: string;
  minDuration?: number;
  maxDuration?: number;
  recommendedText?: string;
  onAudioReady: (base64: string, duration: number, dataUrl: string) => void;
  onClear: () => void;
  isReady: boolean;
  readyDuration?: number;
  readyDataUrl?: string;
}

export function AudioRecorder({
  label,
  minDuration = 10,
  maxDuration = 30,
  recommendedText,
  onAudioReady,
  onClear,
  isReady,
  readyDuration = 0,
  readyDataUrl
}: AudioRecorderProps) {
  const {
    isRecording,
    isConverting,
    duration,
    volume,
    audioBase64,
    dataUrl,
    error,
    startRecording,
    stopRecording,
    resetRecording,
    loadFileAudio
  } = useAudioRecorder();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const lastReportedBase64Ref = useRef<string | null>(null);

  const handleStart = async () => {
    await startRecording();
  };

  const handleStop = async () => {
    stopRecording();
  };

  useEffect(() => {
    if (!isRecording && !isConverting && audioBase64 && dataUrl && duration > 0) {
      if (lastReportedBase64Ref.current !== audioBase64) {
        lastReportedBase64Ref.current = audioBase64;
        onAudioReady(audioBase64, duration, dataUrl);
      }
    }
  }, [isRecording, isConverting, audioBase64, dataUrl, duration, onAudioReady]);

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const converted = await loadFileAudio(file);
      lastReportedBase64Ref.current = converted.base64;
      onAudioReady(converted.base64, converted.duration, converted.dataUrl);
    } catch (err) {
      console.error(err);
    }
  };

  const handleClear = () => {
    lastReportedBase64Ref.current = null;
    resetRecording();
    onClear();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setIsPlayingPreview(false);
  };

  const togglePreview = () => {
    if (!audioPreviewRef.current) return;
    if (isPlayingPreview) {
      audioPreviewRef.current.pause();
      setIsPlayingPreview(false);
    } else {
      audioPreviewRef.current.play().then(() => setIsPlayingPreview(true)).catch(() => {});
    }
  };

  const currentDuration = isReady ? readyDuration : duration;
  const isTooShort = currentDuration > 0 && currentDuration < minDuration;
  const isOptimal = currentDuration >= minDuration && currentDuration <= maxDuration;
  const isTooLong = currentDuration > maxDuration;
  const activePreviewUrl = dataUrl || readyDataUrl;

  return (
    <div className="brutal-card p-4 bg-[#FFFFFF]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-black text-xs text-[#09090B]">{label}</span>
          {minDuration > 0 && (
            <span className="text-[11px] font-mono font-bold px-2 py-0.5 bg-[#F8F9FA] text-[#09090B] border border-[#09090B]">
              建议时长：{minDuration} 至 {maxDuration} 秒
            </span>
          )}
        </div>
        {isReady && (
          <span className="flex items-center gap-1 text-xs font-mono font-black bg-[#D97706] text-[#FFFFFF] border-[1.5px] border-[#09090B] px-2.5 py-0.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            READY ({readyDuration.toFixed(1)}s)
          </span>
        )}
      </div>

      {recommendedText && (
        <div className="mb-3 p-3 bg-[#D97706]/12 border-2 border-[#09090B] text-xs text-[#09090B] leading-relaxed">
          <div className="font-black text-[#D97706] mb-1">【法定授权朗读文案】：</div>
          <div className="select-text bg-[#FFFFFF] p-2.5 border-[1.5px] border-[#09090B] font-mono font-bold text-[#09090B]">
            {recommendedText}
          </div>
        </div>
      )}

      {isRecording && (
        <div className="mb-3 p-3 bg-[#D97706]/15 border-2 border-[#09090B] flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-[#D97706] border border-[#09090B] animate-ping" />
              <span className="text-xs font-black text-[#09090B]">● 正在采集麦克风声纹...</span>
            </div>
            <span className="text-sm font-mono font-black text-[#D97706]">
              {formatAudioTime(duration)}
            </span>
          </div>

          <div className="h-3 w-full bg-[#FFFFFF] border-[1.5px] border-[#09090B] overflow-hidden flex items-center">
            <div
              className="h-full bg-[#D97706] transition-all duration-75"
              style={{ width: `${Math.max(6, volume * 100)}%` }}
            />
          </div>
        </div>
      )}

      {isConverting && (
        <div className="mb-3 p-2.5 bg-[#F8F9FA] border-2 border-[#09090B] flex items-center gap-2 text-xs font-bold text-[#09090B]">
          <Loader2 className="w-4 h-4 animate-spin text-[#D97706]" />
          <span>正在进行 24kHz 单声道 16-bit PCM 音频重采样标准化...</span>
        </div>
      )}

      {currentDuration > 0 && !isRecording && !isConverting && (
        <div className="mb-2 text-xs font-mono font-bold">
          {isOptimal && (
            <span className="text-[#D97706]">★ 时长符合最佳标准（{currentDuration.toFixed(1)} 秒）</span>
          )}
          {isTooShort && (
            <span className="text-[#09090B]">! 录音略短（不足 {minDuration} 秒），建议重录以提高声纹精度</span>
          )}
          {isTooLong && (
            <span className="text-[#09090B]">! 录音超过 {maxDuration} 秒，将自动截取前段特征</span>
          )}
        </div>
      )}

      {error && (
        <div className="mb-3 text-xs font-bold text-[#09090B] bg-[#D97706]/20 p-2.5 border-2 border-[#09090B]">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 mt-2">
        {!isReady && !isRecording && !isConverting && (
          <>
            <button
              onClick={handleStart}
              className="flex-1 brutal-btn-amber flex items-center justify-center gap-2 py-2 px-3 text-xs"
            >
              <Mic className="w-4 h-4" />
              开始麦克风录音
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="brutal-btn flex items-center gap-1.5 py-2 px-3 text-xs"
            >
              <Upload className="w-3.5 h-3.5" />
              本地文件上传
            </button>
            <input
              type="file"
              ref={fileInputRef}
              accept="audio/*"
              className="hidden"
              onChange={handleFileUpload}
            />
          </>
        )}

        {isRecording && (
          <button
            onClick={handleStop}
            className="flex-1 brutal-btn-ink flex items-center justify-center gap-2 py-2 px-3 text-xs animate-tube-pulse"
          >
            <Square className="w-4 h-4 fill-[#D97706] text-[#D97706]" />
            完成录音
          </button>
        )}

        {isReady && !isConverting && (
          <div className="flex-1 flex items-center gap-2">
            {activePreviewUrl && (
              <audio
                ref={audioPreviewRef}
                src={activePreviewUrl}
                onEnded={() => setIsPlayingPreview(false)}
                className="hidden"
              />
            )}
            <button
              onClick={togglePreview}
              disabled={!activePreviewUrl}
              className="flex-1 brutal-btn flex items-center justify-center gap-2 py-2 px-3 text-xs disabled:opacity-50"
            >
              {isPlayingPreview ? (
                <>
                  <Pause className="w-3.5 h-3.5" /> 暂停试听
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" /> 试听录音样本
                </>
              )}
            </button>
            <button
              onClick={handleClear}
              className="brutal-btn p-2 text-[#09090B]"
              title="清除重录"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
