import { useRef } from 'react';
import { Mic, Square, Upload, Play, Pause, Trash2, CheckCircle2 } from 'lucide-react';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { formatAudioTime } from '../utils/audioConverter';

interface AudioRecorderProps {
  label: string;
  minDuration?: number; // In seconds
  maxDuration?: number; // In seconds
  recommendedText?: string;
  onAudioReady: (base64: string, duration: number, dataUrl: string) => void;
  onClear: () => void;
  isReady: boolean;
  readyDuration?: number;
}

export function AudioRecorder({
  label,
  minDuration = 10,
  maxDuration = 30,
  recommendedText,
  onAudioReady,
  onClear,
  isReady,
  readyDuration = 0
}: AudioRecorderProps) {
  const {
    isRecording,
    duration,
    volume,
    dataUrl,
    error,
    startRecording,
    stopRecording,
    resetRecording,
    loadFileAudio
  } = useAudioRecorder();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = React.useState(false);

  // When recorder completes and dataUrl is generated
  React.useEffect(() => {
    if (dataUrl) {
      // Audio ready
    }
  }, [dataUrl]);

  const handleStart = async () => {
    await startRecording();
  };

  const handleStop = async () => {
    stopRecording();
  };

  // Watch for when recording finishes and passes to parent
  React.useEffect(() => {
    if (!isRecording && dataUrl && duration > 0) {
      // Fetch base64 from audio data
      fetch(dataUrl)
        .then(res => res.blob())
        .then(async blob => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64data = (reader.result as string).split(',')[1];
            onAudioReady(base64data, duration, dataUrl);
          };
          reader.readAsDataURL(blob);
        });
    }
  }, [isRecording, dataUrl, duration, onAudioReady]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const converted = await loadFileAudio(file);
      onAudioReady(converted.base64, converted.duration, converted.dataUrl);
    } catch (err) {
      console.error(err);
    }
  };

  const handleClear = () => {
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

  // Determine duration quality status
  const currentDuration = isReady ? readyDuration : duration;
  const isTooShort = currentDuration > 0 && currentDuration < minDuration;
  const isOptimal = currentDuration >= minDuration && currentDuration <= maxDuration;
  const isTooLong = currentDuration > maxDuration;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition-all hover:border-slate-700">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-slate-200">{label}</span>
          {minDuration > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
              建议时长：{minDuration} 至 {maxDuration} 秒
            </span>
          )}
        </div>
        {isReady && (
          <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium bg-emerald-950/40 border border-emerald-800/50 px-2 py-0.5 rounded-full">
            <CheckCircle2 className="w-3.5 h-3.5" />
            已就绪 ({readyDuration.toFixed(1)}s)
          </span>
        )}
      </div>

      {recommendedText && (
        <div className="mb-3 p-3 rounded-lg bg-indigo-950/30 border border-indigo-800/40 text-xs text-indigo-200 leading-relaxed">
          <div className="font-medium text-indigo-300 mb-1">【法定授权朗读文案】：</div>
          <div className="select-text bg-slate-950/50 p-2 rounded border border-indigo-900/40 font-mono text-slate-100">
            {recommendedText}
          </div>
        </div>
      )}

      {/* Recording in progress feedback */}
      {isRecording && (
        <div className="mb-3 p-3 rounded-lg bg-rose-950/20 border border-rose-800/50 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
              <span className="text-xs font-medium text-rose-300">正在录音中...</span>
            </div>
            <span className="text-sm font-mono font-bold text-rose-200">
              {formatAudioTime(duration)}
            </span>
          </div>

          {/* Volume dynamic bar */}
          <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden flex items-center">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500 transition-all duration-75 rounded-full"
              style={{ width: `${Math.max(5, volume * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Duration status tag */}
      {currentDuration > 0 && !isRecording && (
        <div className="mb-2 text-xs">
          {isOptimal && (
            <span className="text-emerald-400">✓ 时长符合最佳标准（{currentDuration.toFixed(1)} 秒）</span>
          )}
          {isTooShort && (
            <span className="text-amber-400">! 录音略短（不足 {minDuration} 秒），可能影响声纹模型精度</span>
          )}
          {isTooLong && (
            <span className="text-amber-400">! 录音超过 {maxDuration} 秒，将自动裁剪前段特征</span>
          )}
        </div>
      )}

      {error && (
        <div className="mb-3 text-xs text-rose-400 bg-rose-950/30 p-2 rounded border border-rose-900/40">
          {error}
        </div>
      )}

      {/* Operation Actions */}
      <div className="flex items-center gap-2 mt-2">
        {!isReady && !isRecording && (
          <>
            <button
              onClick={handleStart}
              className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md transition"
            >
              <Mic className="w-4 h-4" />
              开始麦克风录音
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
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
            className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-rose-400 border border-rose-600/50 text-xs font-semibold shadow-md transition animate-pulse"
          >
            <Square className="w-4 h-4 fill-rose-500 text-rose-500" />
            完成录音
          </button>
        )}

        {isReady && (
          <div className="flex-1 flex items-center gap-2">
            {dataUrl && (
              <audio
                ref={audioPreviewRef}
                src={dataUrl}
                onEnded={() => setIsPlayingPreview(false)}
                className="hidden"
              />
            )}
            <button
              onClick={togglePreview}
              className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-medium transition"
            >
              {isPlayingPreview ? (
                <>
                  <Pause className="w-3.5 h-3.5" /> 暂停试听
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" /> 试听录音
                </>
              )}
            </button>
            <button
              onClick={handleClear}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-rose-400 transition"
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

import React from 'react';
