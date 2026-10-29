import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, Download, RotateCcw } from 'lucide-react';
import { formatAudioTime, base64ToBlob } from '../utils/audioConverter';

interface WaveformPlayerProps {
  audioBase64?: string | null;
  audioUrl?: string | null;
  title?: string;
  durationHint?: number;
  onExport?: () => void;
  autoPlay?: boolean;
  onAutoPlayHandled?: () => void;
  compact?: boolean;
}

const NUM_BARS = 38;
const DEFAULT_WAVE_PROFILE = Array.from({ length: NUM_BARS }, (_, i) => {
  const v =
    Math.sin(i * 0.48) * 0.32 +
    Math.cos(i * 1.18) * 0.24 +
    Math.sin(i * 2.05) * 0.14 +
    0.54;
  return Math.max(0.24, Math.min(0.96, v));
});

export function WaveformPlayer({
  audioBase64,
  audioUrl,
  title = '合成音频预览',
  durationHint = 0,
  onExport,
  autoPlay = false,
  onAutoPlayHandled,
  compact = false
}: WaveformPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationHint);
  const [volume, setVolume] = useState(0.9);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [barHeights, setBarHeights] = useState<number[]>(DEFAULT_WAVE_PROFILE);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);

  useEffect(() => {
    if (durationHint > 0 && duration === 0) {
      setDuration(durationHint);
    }
  }, [durationHint, duration]);

  useEffect(() => {
    if (audioUrl) {
      setBlobUrl(audioUrl);
    } else if (audioBase64) {
      try {
        const blob = base64ToBlob(audioBase64, 'audio/wav');
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
        return () => {
          URL.revokeObjectURL(url);
        };
      } catch (err) {
        console.error('Failed to parse base64 audio', err);
      }
    } else {
      setBlobUrl(null);
    }
  }, [audioBase64, audioUrl]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setBarHeights(DEFAULT_WAVE_PROFILE);
    if (audioRef.current && blobUrl) {
      audioRef.current.load();
      if (autoPlay) {
        onAutoPlayHandled?.();
        audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    }
  }, [blobUrl]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      sourceNodeRef.current = null;
      analyserRef.current = null;
    };
  }, []);

  const setupWebAudio = useCallback(() => {
    if (!audioRef.current || audioContextRef.current) return;
    try {
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      const source = audioCtx.createMediaElementSource(audioRef.current);
      source.connect(analyser);
      analyser.connect(audioCtx.destination);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;
      sourceNodeRef.current = source;
    } catch (err) {
      console.warn('AudioContext setup skipped', err);
    }
  }, []);

  const updateLiveBars = useCallback(() => {
    if (analyserRef.current && isPlaying) {
      const freqData = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(freqData);
      const next: number[] = [];
      for (let i = 0; i < NUM_BARS; i++) {
        const idx = Math.floor((i / NUM_BARS) * (freqData.length * 0.75));
        const val = freqData[idx] / 255;
        next.push(Math.max(0.22, Math.min(0.98, val * 0.85 + DEFAULT_WAVE_PROFILE[i] * 0.25)));
      }
      setBarHeights(next);
      animationFrameRef.current = requestAnimationFrame(updateLiveBars);
    } else {
      setBarHeights(DEFAULT_WAVE_PROFILE);
    }
  }, [isPlaying]);

  useEffect(() => {
    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(updateLiveBars);
    } else {
      setBarHeights(DEFAULT_WAVE_PROFILE);
    }
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, updateLiveBars]);

  const togglePlay = () => {
    if (!audioRef.current || !blobUrl) return;
    setupWebAudio();
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(err => {
        console.error('Playback error', err);
      });
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current && audioRef.current.duration && isFinite(audioRef.current.duration)) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    setBarHeights(DEFAULT_WAVE_PROFILE);
  };

  const handleStripSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration || !stripRef.current) return;
    const rect = stripRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const nextTime = ratio * duration;
    audioRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    setIsMuted(val === 0);
    if (audioRef.current) {
      audioRef.current.volume = val;
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    if (isMuted) {
      audioRef.current.volume = volume || 0.8;
      setIsMuted(false);
    } else {
      audioRef.current.volume = 0;
      setIsMuted(true);
    }
  };

  const cycleSpeed = () => {
    const speeds = [0.75, 1.0, 1.25, 1.5, 2.0];
    const nextIdx = (speeds.indexOf(playbackRate) + 1) % speeds.length;
    const nextSpeed = speeds[nextIdx];
    setPlaybackRate(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  };

  const effectiveDuration = duration || durationHint || 0;
  const progressRatio = effectiveDuration > 0 ? Math.min(1, currentTime / effectiveDuration) : 0;

  return (
    <div className={`${compact ? 'brutal-card p-4' : 'brutal-box px-5 py-4'} flex items-center gap-5 bg-[#FFFFFF]`}>
      {blobUrl && (
        <audio
          ref={audioRef}
          src={blobUrl}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
        />
      )}

      {/* Square Brutalist Play Button */}
      <button
        onClick={togglePlay}
        disabled={!blobUrl}
        className={`${compact ? 'w-12 h-12' : 'w-14 h-14'} brutal-btn-amber flex items-center justify-center flex-shrink-0 disabled:opacity-40 ${
          isPlaying ? 'animate-tube-pulse' : ''
        }`}
        title={isPlaying ? '暂停播放' : '播放母带'}
      >
        {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-0.5" />}
      </button>

      {/* Center Vector Waveform Strip */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-4 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-block w-2.5 h-2.5 bg-[#D97706] border-[1.5px] border-[#09090B] flex-shrink-0" />
            <span className="font-mono text-sm font-black text-[#09090B] truncate">
              04 // TUBE MONITOR · {blobUrl ? title : '24kHz 矢量声波监听'}
            </span>
          </div>
          <div className="font-mono text-sm font-black text-[#D97706] flex-shrink-0">
            {formatAudioTime(currentTime)} / {formatAudioTime(effectiveDuration)}
          </div>
        </div>

        {/* 100% Vector DOM Waveform Strip (Zero Canvas Blur!) */}
        <div
          ref={stripRef}
          onClick={handleStripSeek}
          className="w-full h-11 px-3 py-1.5 bg-[#F8F9FA] border-2 border-[#09090B] rounded-[5px] flex items-center justify-between gap-[5px] cursor-pointer"
          title="点击任意声波位置定位播放进度"
        >
          {barHeights.map((ratio, idx) => {
            const barPos = (idx + 0.5) / NUM_BARS;
            const isPlayed = progressRatio > 0 ? barPos <= progressRatio : idx < 15;
            const heightPx = Math.max(8, Math.round(ratio * 28));
            return (
              <div
                key={idx}
                style={{ height: `${heightPx}px` }}
                className={`flex-1 border-[1.5px] border-[#09090B] rounded-[1px] transition-all duration-100 ${
                  isPlayed ? 'bg-[#D97706]' : 'bg-[#FFFFFF]'
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* Right Hardware Controls */}
      <div className="flex items-center gap-2.5 flex-shrink-0">
        <button
          onClick={() => {
            if (audioRef.current) {
              audioRef.current.currentTime = 0;
              setCurrentTime(0);
            }
          }}
          disabled={!blobUrl}
          className="brutal-btn p-2.5 disabled:opacity-40"
          title="重置到开头"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <button
          onClick={cycleSpeed}
          title="切换播放倍速"
          className="brutal-btn px-3 py-2 text-sm font-mono font-black"
        >
          {playbackRate}×
        </button>

        {!compact && (
          <div className="hidden xl:flex items-center gap-2 px-3 py-2 border-2 border-[#09090B] bg-[#F8F9FA] rounded-[5px]">
            <button onClick={toggleMute} className="text-[#09090B] hover:text-[#D97706] transition">
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="w-16 brutal-range"
            />
          </div>
        )}

        {onExport && (
          <button
            onClick={onExport}
            disabled={!blobUrl}
            title="导出 24kHz WAV 文件"
            className="brutal-btn px-4 py-2 text-sm font-mono font-black flex items-center gap-1.5 disabled:opacity-40"
          >
            <Download className="w-4 h-4" />
            <span>导出 WAV</span>
          </button>
        )}
      </div>
    </div>
  );
}
