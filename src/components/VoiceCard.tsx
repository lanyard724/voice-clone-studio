import { useState, useRef } from 'react';
import { Play, Pause, Star, Trash2, Edit2, Check, X, Volume2 } from 'lucide-react';
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
      className={`relative brutal-card brutal-card-interactive p-5 cursor-pointer flex flex-col justify-between ${
        isSelected ? 'bg-[#D97706]/14 border-[#09090B]' : 'bg-[#FFFFFF]'
      }`}
    >
      {voice.sampleAudioUrl && (
        <audio
          ref={audioRef}
          src={voice.sampleAudioUrl}
          onEnded={() => setIsPlayingSample(false)}
        />
      )}

      <div>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 flex-wrap font-mono">
            {voice.type === 'replicated' ? (
              <span className="text-xs font-black px-2.5 py-1 bg-[#D97706] text-[#FFFFFF] border-2 border-[#09090B]">
                CLONED · 专属克隆
              </span>
            ) : (
              <span className="text-xs font-black px-2.5 py-1 bg-[#F8F9FA] text-[#09090B] border-2 border-[#09090B]">
                PREBUILT · 官方预设
              </span>
            )}
            {voice.isFavorite && (
              <span className="text-xs font-black px-2 py-1 bg-[#09090B] text-[#D97706] border-2 border-[#09090B]">
                ★ 收藏
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => onToggleFavorite(voice.id)}
              className={`p-1.5 border-2 border-[#09090B] transition ${
                voice.isFavorite
                  ? 'bg-[#D97706] text-[#FFFFFF]'
                  : 'bg-[#F8F9FA] text-[#09090B] hover:bg-[#D97706]/20'
              }`}
              title="收藏声线"
            >
              <Star className="w-4 h-4 fill-current" />
            </button>

            {voice.type === 'replicated' && (
              <>
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-1.5 border-2 border-[#09090B] bg-[#F8F9FA] text-[#09090B] hover:bg-[#D97706]/20 transition"
                  title="重命名声线"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setIsConfirmingDelete(true)}
                  className="p-1.5 border-2 border-[#09090B] bg-[#F8F9FA] text-[#09090B] hover:bg-[#09090B] hover:text-[#FFFFFF] transition"
                  title="删除声线"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>

        {isEditing ? (
          <div className="flex items-center gap-1.5 my-2" onClick={e => e.stopPropagation()}>
            <input
              type="text"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="flex-1 brutal-input px-3 py-1.5 text-sm font-bold"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') handleSaveRename();
                if (e.key === 'Escape') setIsEditing(false);
              }}
            />
            <button
              onClick={handleSaveRename}
              className="p-2 border-2 border-[#09090B] bg-[#D97706] text-[#FFFFFF]"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="p-2 border-2 border-[#09090B] bg-[#F8F9FA] text-[#09090B]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <h3 className="font-black text-lg text-[#09090B] truncate mb-1">
            {voice.displayName}
          </h3>
        )}

        <div className="text-xs font-mono font-bold text-[#09090B]/65 truncate mb-2.5">
          ID: {voice.id}
        </div>

        {voice.description && (
          <p className="text-sm font-medium text-[#09090B]/80 line-clamp-2 mb-3">
            {voice.description}
          </p>
        )}

        {voice.tags && voice.tags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mb-3 font-mono">
            {voice.tags.map((tag, i) => (
              <span
                key={i}
                className="text-xs font-bold px-2 py-0.5 bg-[#F8F9FA] text-[#09090B] border-[1.5px] border-[#09090B]"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {isConfirmingDelete && (
        <div
          className="absolute inset-0 bg-[#FFFFFF] p-5 flex flex-col justify-center items-center gap-3 z-10 border-2 border-[#09090B]"
          onClick={e => e.stopPropagation()}
        >
          <div className="text-sm text-[#09090B] font-black text-center">
            确定删除该声线吗？此操作将同步移除本地声纹记录。
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => {
                onDelete(voice.id);
                setIsConfirmingDelete(false);
              }}
              className="brutal-btn-amber px-4 py-1.5 text-sm"
            >
              确认删除
            </button>
            <button
              onClick={() => setIsConfirmingDelete(false)}
              className="brutal-btn px-4 py-1.5 text-sm"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t-2 border-[#09090B] mt-2">
        {voice.sampleAudioUrl ? (
          <button
            onClick={toggleSample}
            className="brutal-btn flex items-center gap-1.5 text-sm py-1.5 px-3"
          >
            {isPlayingSample ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            <span>试听样本</span>
          </button>
        ) : (
          <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-[#09090B]/65">
            <Volume2 className="w-4 h-4" />
            <span>24kHz PCM</span>
          </div>
        )}

        <button
          onClick={() => onSelect(voice.id)}
          className={`text-sm px-3.5 py-1.5 font-mono ${
            isSelected ? 'brutal-btn-amber' : 'brutal-btn'
          }`}
        >
          {isSelected ? '★ 当前选用' : '选用声线 →'}
        </button>
      </div>
    </div>
  );
}
