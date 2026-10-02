import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, Download, RotateCcw } from 'lucide-react';
import { formatAudioTime, base64ToBlob } from '../utils/audioConverter';

interface WaveformPlayerProps {
  audioBase64?: string | null;
  audioUrl?: string | null;
  title?: string;
  onExport?: () => void;
  autoPlay?: boolean;
}

export function WaveformPlayer({
  audioBase64,
  audioUrl,
  title = '合成音频预览',
  onExport,
  autoPlay = false
}: WaveformPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.9);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);

  // Generate blob URL from base64 if audioUrl not directly provided
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

  // Reset and autoPlay when blobUrl changes
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (audioRef.current && blobUrl) {
      audioRef.current.load();
      if (autoPlay) {
        audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    }
  }, [blobUrl, autoPlay]);

  // Clean up Web Audio context on unmount to prevent hardware audio context limit exhaustion
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

  // Setup Web Audio Analyser for canvas animation
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
      // AudioContext already connected or cross-origin restriction
      console.warn('AudioContext setup skipped', err);
    }
  }, []);

  // Draw waveform canvas
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const numBars = 48;
    const barWidth = 4;
    const barSpacing = (width - numBars * barWidth) / (numBars - 1);

    let freqData: Uint8Array | null = null;
    if (analyserRef.current && isPlaying) {
      freqData = new Uint8Array(new ArrayBuffer(analyserRef.current.frequencyBinCount));
      analyserRef.current.getByteFrequencyData(freqData as any);
    }

    const progress = duration > 0 ? currentTime / duration : 0;

    for (let i = 0; i < numBars; i++) {
      const x = i * (barWidth + barSpacing);
      const isPast = (i / numBars) <= progress;

      let barHeight = 6;
      if (freqData && isPlaying) {
        const freqIdx = Math.floor((i / numBars) * freqData.length);
        const val = freqData[freqIdx] / 255;
        barHeight = Math.max(6, val * (height - 8));
      } else {
        // Static pleasant wave shape when idle
        const sinVal = Math.sin((i / numBars) * Math.PI) * 0.7 + 0.3;
        barHeight = Math.max(6, sinVal * (height * 0.6));
      }

      const y = (height - barHeight) / 2;

      // Color based on playback progress
      if (isPast) {
        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
        gradient.addColorStop(0, '#818cf8');
        gradient.addColorStop(1, '#4f46e5');
        ctx.fillStyle = gradient;
      } else {
        ctx.fillStyle = '#334155';
      }

      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 2);
      ctx.fill();
    }

    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(drawWaveform);
    }
  }, [currentTime, duration, isPlaying]);

  useEffect(() => {
    drawWaveform();
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [drawWaveform]);

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
    if (audioRef.current) {
      setDuration(audioRef.current.duration || 0);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    drawWaveform();
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
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

  if (!blobUrl) {
    return (
      <div className="h-28 rounded-xl border border-dashed border-slate-800 bg-slate-900/40 flex items-center justify-center text-slate-500 text-sm">
        暂无音频，输入文本并点击「生成语音」后在此播放
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 shadow-xl backdrop-blur-sm">
      {/* Audio element */}
      <audio
        ref={audioRef}
        src={blobUrl}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
      />

      {/* Header and Title */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <h4 className="text-sm font-medium text-slate-200 truncate max-w-xs">{title}</h4>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={cycleSpeed}
            title="切换播放倍速"
            className="text-xs px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-indigo-300 font-mono transition"
          >
            {playbackRate}×
          </button>
          {onExport && (
            <button
              onClick={onExport}
              title="导出高质量 WAV 文件"
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-indigo-600/80 hover:bg-indigo-600 text-white font-medium transition shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              导出 WAV
            </button>
          )}
        </div>
      </div>

      {/* Canvas Waveform Display */}
      <div className="relative w-full h-14 bg-slate-950/80 rounded-lg overflow-hidden border border-slate-800/80 my-2">
        <canvas
          ref={canvasRef}
          width={600}
          height={56}
          className="w-full h-full block"
        />
      </div>

      {/* Controls & Timeline */}
      <div className="flex items-center gap-3 mt-3">
        {/* Play/Pause Button */}
        <button
          onClick={togglePlay}
          className="w-10 h-10 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition shadow-lg shadow-indigo-600/20 flex-shrink-0"
        >
          {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
        </button>

        {/* Reset Button */}
        <button
          onClick={() => {
            if (audioRef.current) {
              audioRef.current.currentTime = 0;
              setCurrentTime(0);
            }
          }}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          title="重置到开头"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        {/* Time Progress Slider */}
        <div className="flex-1 flex items-center gap-2">
          <span className="text-xs font-mono text-slate-400 w-10 text-right">
            {formatAudioTime(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.01}
            value={currentTime}
            onChange={handleSeek}
            className="flex-1 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
          <span className="text-xs font-mono text-slate-500 w-10">
            {formatAudioTime(duration)}
          </span>
        </div>

        {/* Volume controls */}
        <div className="flex items-center gap-1.5 flex-shrink-0 pl-2 border-l border-slate-800">
          <button
            onClick={toggleMute}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className="w-16 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
        </div>
      </div>
    </div>
  );
}
