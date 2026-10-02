import { useState, useRef } from 'react';
import { Play, Pause, Star, Trash2, Edit2, Check, X, Sparkles, Volume2 } from 'lucide-react';
import { VoiceItem } from '../api/types';

interface VoiceCardProps {
  voice: VoiceItem;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  onToggleFavorite: (id: string) => void;
  onDelete: (id: string) => void;
}

export function VoiceCard({
  voice,
  isSelected,
  onSelect,
  onRename,
  onToggleFavorite,
  onDelete
}: VoiceCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(voice.displayName);
  const [isPlayingSample, setIsPlayingSample] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleSaveRename = () => {
    if (editName.trim()) {
      onRename(voice.id, editName.trim());
    }
    setIsEditing(false);
  };

  const toggleSample = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!audioRef.current) return;
    if (isPlayingSample) {
      audioRef.current.pause();
      setIsPlayingSample(false);
    } else {
      audioRef.current.play().then(() => {
        setIsPlayingSample(true);
      }).catch(err => {
        console.warn('Sample audio play error', err);
      });
    }
  };

  return (
    <div
      onClick={() => onSelect(voice.id)}
      className={`relative rounded-xl border p-4 transition-all cursor-pointer flex flex-col justify-between ${
        isSelected
          ? 'border-indigo-500 bg-indigo-950/20 shadow-lg shadow-indigo-500/10'
          : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900/90'
      }`}
    >
      {/* Hidden sample audio element */}
      {voice.sampleAudioUrl && (
        <audio
          ref={audioRef}
          src={voice.sampleAudioUrl}
          onEnded={() => setIsPlayingSample(false)}
        />
      )}

      {/* Top Header */}
      <div>
        <div className="flex items-start justify-between gap-2 mb-2">
          {/* Badge */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {voice.type === 'replicated' ? (
              <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                <Sparkles className="w-3 h-3" />
                克隆声线
              </span>
            ) : (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-medium">
                官方预设
              </span>
            )}
            {voice.isFavorite && (
              <span className="text-amber-400 text-xs">★ 收藏</span>
            )}
          </div>

          {/* Action icons */}
          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => onToggleFavorite(voice.id)}
              className={`p-1 rounded hover:bg-slate-800 transition ${
                voice.isFavorite ? 'text-amber-400' : 'text-slate-500 hover:text-slate-300'
              }`}
              title="收藏声线"
            >
              <Star className="w-3.5 h-3.5 fill-current" />
            </button>

            {voice.type === 'replicated' && (
              <>
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition"
                  title="重命名声线"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setIsConfirmingDelete(true)}
                  className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition"
                  title="删除声线"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Title or Inline Edit */}
        {isEditing ? (
          <div className="flex items-center gap-1 my-1" onClick={e => e.stopPropagation()}>
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="flex-1 bg-slate-950 border border-indigo-500 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') handleSaveRename();
                if (e.key === 'Escape') setIsEditing(false);
              }}
            />
            <button
              onClick={handleSaveRename}
              className="p-1 rounded bg-indigo-600 text-white hover:bg-indigo-500"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="p-1 rounded bg-slate-800 text-slate-400 hover:bg-slate-700"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <h3 className="font-semibold text-sm text-slate-100 truncate mb-1">
            {voice.displayName}
          </h3>
        )}

        {/* ID snippet & description */}
        <div className="text-[11px] font-mono text-slate-500 truncate mb-2">
          ID: {voice.id}
        </div>

        {voice.description && (
          <p className="text-xs text-slate-400 line-clamp-2 mb-3">
            {voice.description}
          </p>
        )}

        {/* Tags */}
        {voice.tags && voice.tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap mb-3">
            {voice.tags.map((tag, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400 border border-slate-700/50">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation layer */}
      {isConfirmingDelete && (
        <div
          className="absolute inset-0 bg-slate-950/95 rounded-xl p-4 flex flex-col justify-center items-center gap-3 z-10 border border-rose-900/60"
          onClick={e => e.stopPropagation()}
        >
          <div className="text-xs text-rose-300 font-medium text-center">
            确定删除该声线吗？此操作将同步销毁云端与本地声纹模型。
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onDelete(voice.id);
                setIsConfirmingDelete(false);
              }}
              className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs font-semibold"
            >
              确认删除
            </button>
            <button
              onClick={() => setIsConfirmingDelete(false)}
              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Bottom Bar: Sample button and Selection Indicator */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 mt-1">
        {voice.sampleAudioUrl ? (
          <button
            onClick={toggleSample}
            className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 py-1 px-2 rounded hover:bg-indigo-950/40 transition"
          >
            {isPlayingSample ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>试听录音样本</span>
          </button>
        ) : (
          <div className="flex items-center gap-1 text-[11px] text-slate-500">
            <Volume2 className="w-3.5 h-3.5" />
            <span>无采样切片</span>
          </div>
        )}

        <button
          onClick={() => onSelect(voice.id)}
          className={`text-xs px-2.5 py-1 rounded font-medium transition ${
            isSelected
              ? 'bg-indigo-600 text-white'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          {isSelected ? '已选用' : '选用声线'}
        </button>
      </div>
    </div>
  );
}
