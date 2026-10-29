import { useState } from 'react';
import { X, Sparkles, AlertCircle, Loader2 } from 'lucide-react';
import { AudioRecorder } from './AudioRecorder';
import { CloneVoicePayload } from '../api/types';

interface CloneModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCloneSubmit: (payload: CloneVoicePayload, sampleDataUrl?: string) => Promise<unknown>;
}

export function CloneModal({ isOpen, onClose, onCloneSubmit }: CloneModalProps) {
  const [displayName, setDisplayName] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [sourceAudioBase64, setSourceAudioBase64] = useState<string | null>(null);
  const [sourceDuration, setSourceDuration] = useState(0);
  const [sourceDataUrl, setSourceDataUrl] = useState<string | null>(null);

  const [consentAudioBase64, setConsentAudioBase64] = useState<string | null>(null);
  const [consentDuration, setConsentDuration] = useState(0);
  const [consentDataUrl, setConsentDataUrl] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [consentLanguage, setConsentLanguage] = useState<'zh' | 'en'>('zh');

  if (!isOpen) return null;

  const consentText = consentLanguage === 'zh'
    ? '我是此声音的拥有者并授权谷歌使用此声音创建语音合成模型'
    : 'I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model.';

  const isFormValid = !!(
    displayName.trim() &&
    sourceAudioBase64 &&
    consentAudioBase64 &&
    sourceDuration >= 5 &&
    consentDuration >= 2
  );

  const handleSubmit = async () => {
    if (!isFormValid || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);

    const tags = tagsInput
      .split(/[,，\s]+/)
      .map(t => t.trim())
      .filter(Boolean);

    try {
      await onCloneSubmit(
        {
          displayName: displayName.trim(),
          sourceAudioBase64: sourceAudioBase64!,
          consentAudioBase64: consentAudioBase64!,
          store: true,
          tags: tags.length > 0 ? tags : ['克隆声线']
        },
        sourceDataUrl || undefined
      );
      onClose();
    } catch (err) {
      console.error('Clone failed', err);
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#09090B]/55 backdrop-blur-[2px] flex items-center justify-center p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl brutal-box bg-[#FFFFFF] overflow-hidden my-8 animate-panel-enter">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b-2 border-[#09090B] bg-[#F8F9FA]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#D97706] border-2 border-[#09090B] shadow-[2px_2px_0_#09090B] flex items-center justify-center text-[#FFFFFF]">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-black text-[#09090B]">
                VOICE REPLICATION // 声线克隆工坊
              </h2>
              <p className="text-xs font-mono font-bold text-[#D97706]">
                GEMINI 3.8 FLASH TTS · 24kHz 声纹特征提取
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="brutal-btn p-1.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto bg-[#FFFFFF]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-black text-[#09090B] mb-1.5">
                声线昵称 <span className="text-[#D97706]">● 必填</span>
              </label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="例如：阿岚的专属播客音色"
                className="w-full brutal-input px-3.5 py-2 text-sm font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-black text-[#09090B] mb-1.5">
                声线标签 (逗号或空格分隔)
              </label>
              <input
                type="text"
                value={tagsInput}
                onChange={e => setTagsInput(e.target.value)}
                placeholder="例如：男声 沉稳 科技感"
                className="w-full brutal-input px-3.5 py-2 text-sm font-bold"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-[#09090B] font-mono">
                01 // 轨道一：参考人声音频 (Source Audio) <span className="text-[#D97706]">●</span>
              </span>
            </div>
            <AudioRecorder
              label="说话人原声样本（清晰人声，无背景音乐杂音）"
              minDuration={10}
              maxDuration={30}
              isReady={!!sourceAudioBase64}
              readyDuration={sourceDuration}
              readyDataUrl={sourceDataUrl || undefined}
              onAudioReady={(base64, duration, dataUrl) => {
                setSourceAudioBase64(base64);
                setSourceDuration(duration);
                setSourceDataUrl(dataUrl);
              }}
              onClear={() => {
                setSourceAudioBase64(null);
                setSourceDuration(0);
                setSourceDataUrl(null);
              }}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-[#09090B] font-mono">
                02 // 轨道二：法定授权朗读录音 (Consent Audio) <span className="text-[#D97706]">●</span>
              </span>
              <div className="flex items-center gap-1.5 text-xs font-mono">
                <button
                  type="button"
                  onClick={() => setConsentLanguage('zh')}
                  className={`px-2.5 py-0.5 text-[11px] ${
                    consentLanguage === 'zh' ? 'brutal-btn-amber' : 'brutal-btn'
                  }`}
                >
                  中文文案
                </button>
                <button
                  type="button"
                  onClick={() => setConsentLanguage('en')}
                  className={`px-2.5 py-0.5 text-[11px] ${
                    consentLanguage === 'en' ? 'brutal-btn-amber' : 'brutal-btn'
                  }`}
                >
                  English
                </button>
              </div>
            </div>
            <AudioRecorder
              label="必须由同一说话人清晰完整朗读法定授权词"
              minDuration={3}
              maxDuration={15}
              recommendedText={consentText}
              isReady={!!consentAudioBase64}
              readyDuration={consentDuration}
              readyDataUrl={consentDataUrl || undefined}
              onAudioReady={(base64, duration, dataUrl) => {
                setConsentAudioBase64(base64);
                setConsentDuration(duration);
                setConsentDataUrl(dataUrl);
              }}
              onClear={() => {
                setConsentAudioBase64(null);
                setConsentDuration(0);
                setConsentDataUrl(null);
              }}
            />
          </div>

          <div className="p-3.5 bg-[#D97706]/12 border-2 border-[#09090B] flex items-start gap-2.5 text-xs font-bold text-[#09090B] leading-relaxed">
            <AlertCircle className="w-4 h-4 text-[#D97706] flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-black text-[#D97706]">【Google 声纹校验要求】</span>：
              参考音频与授权录音必须由「同一说话人」录制（云端强制比对声纹特征）。授权词必须一字不差完整朗读。
            </div>
          </div>

          {submitError && (
            <div className="p-3.5 bg-[#09090B] text-[#FFFFFF] border-2 border-[#09090B] text-xs font-mono whitespace-pre-line leading-relaxed">
              <span className="text-[#D97706] font-black">ERROR // </span>
              {submitError}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t-2 border-[#09090B] bg-[#F8F9FA]">
          <button
            onClick={onClose}
            className="brutal-btn px-4 py-2 text-xs"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isFormValid || isSubmitting}
            className="brutal-btn-amber flex items-center gap-2 px-5 py-2 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>正在克隆与构建声纹...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>★ 提交克隆声线</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
