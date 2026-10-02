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
    sourceDuration >= 5 && // At least 5s, optimal 10-30s
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
      // Reset and close
      onClose();
    } catch (err) {
      console.error('Clone failed', err);
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-8">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">声线克隆工坊 (Voice Replication)</h2>
              <p className="text-xs text-slate-400">基于 Gemini 3.8 Flash TTS 提取录音棚级说话人声纹特征</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Voice Meta Input */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                声线昵称 <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="例如：阿岚的专属播客音色"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                声线标签 (逗号或空格分隔)
              </label>
              <input
                type="text"
                value={tagsInput}
                onChange={e => setTagsInput(e.target.value)}
                placeholder="例如：男声 沉稳 科技感"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>
          </div>

          {/* Track 1: Source Audio */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">
                轨道一：参考人声音频 (Source Audio) <span className="text-rose-500">*</span>
              </span>
            </div>
            <AudioRecorder
              label="说话人原声样本（清晰人声，建议无背景音乐杂音）"
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

          {/* Track 2: Consent Audio */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">
                轨道二：法定授权朗读录音 (Consent Audio) <span className="text-rose-500">*</span>
              </span>
              <div className="flex items-center gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setConsentLanguage('zh')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                    consentLanguage === 'zh'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  中文文案
                </button>
                <button
                  type="button"
                  onClick={() => setConsentLanguage('en')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                    consentLanguage === 'en'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
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

          {/* Compliance & Safety Warning */}
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5 text-xs text-amber-200/90 leading-relaxed">
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-amber-300">【Google 声纹校验要求】</span>：
              参考音频与授权录音必须由<span className="text-white underline underline-offset-2">同一说话人</span>录制（云端强制比对声纹特征）。
              授权词必须一字不差完整朗读，不可漏字改字或提前掐断。
            </div>
          </div>

          {submitError && (
            <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-800/80 text-xs text-rose-200 whitespace-pre-line leading-relaxed shadow-lg">
              {submitError}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-800 bg-slate-950/50">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:bg-slate-800 transition"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isFormValid || isSubmitting}
            className={`flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold shadow-lg transition ${
              isFormValid && !isSubmitting
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>正在克隆与构建声纹...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>提交克隆声线</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
