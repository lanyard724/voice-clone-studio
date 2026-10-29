import { useState, useEffect } from 'react';
import { X, Key, Globe, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2, Cpu, Sparkles } from 'lucide-react';
import { AppSettings, ConnectionTestResult, LlmDirectorModel } from '../api/types';
import { testConnection } from '../api/gemini';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (updated: Partial<AppSettings>) => Promise<void>;
}

export function SettingsModal({ isOpen, onClose, settings, onSave }: SettingsModalProps) {
  const [apiKey, setApiKey] = useState(settings.apiKey || '');
  const [proxyUrl, setProxyUrl] = useState(settings.proxyUrl || 'http://127.0.0.1:7900');
  const [autoPlay, setAutoPlay] = useState(settings.autoPlay ?? true);
  const [defaultModel, setDefaultModel] = useState(settings.defaultModel || 'gemini-3.8-flash-tts');
  const [llmModel, setLlmModel] = useState<LlmDirectorModel>(settings.llmModel || 'gemini-4-argon');
  const [showKey, setShowKey] = useState(false);

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  useEffect(() => {
    if (isOpen) {
      setApiKey(settings.apiKey || '');
      setProxyUrl(settings.proxyUrl || 'http://127.0.0.1:7900');
      setAutoPlay(settings.autoPlay ?? true);
      setDefaultModel(settings.defaultModel || 'gemini-3.8-flash-tts');
      setLlmModel(settings.llmModel || 'gemini-4-argon');
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(apiKey.trim());
      setTestResult(result);
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    await onSave({
      apiKey: apiKey.trim(),
      proxyUrl: proxyUrl.trim(),
      autoPlay,
      defaultModel,
      llmModel
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#09090B]/55 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="relative w-full max-w-lg brutal-box bg-[#FFFFFF] overflow-hidden animate-panel-enter">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b-2 border-[#09090B] bg-[#F8F9FA]">
          <div className="flex items-center gap-2.5">
            <span className="px-2 py-0.5 bg-[#D97706] text-[#FFFFFF] border-[1.5px] border-[#09090B] font-mono text-xs font-black">
              CONFIG
            </span>
            <h2 className="text-base font-black text-[#09090B]">系统与网络代理配置</h2>
          </div>
          <button
            onClick={onClose}
            className="brutal-btn p-1.5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 bg-[#FFFFFF]">
          {/* Gemini API Key */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="flex items-center gap-1.5 text-xs font-black text-[#09090B]">
                <Key className="w-3.5 h-3.5 text-[#D97706]" />
                Google Gemini API Key
              </label>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-mono font-bold text-[#D97706] hover:underline"
              >
                获取 API Key →
              </a>
            </div>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="AIzaSy... 或 AQ...."
                className="w-full brutal-input px-3.5 py-2 pr-10 text-sm font-mono font-bold"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#09090B]/60 hover:text-[#09090B]"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Network Proxy */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-black text-[#09090B] mb-1.5">
              <Globe className="w-3.5 h-3.5 text-[#D97706]" />
              本地网络代理 (Proxy Server)
            </label>
            <input
              type="text"
              value={proxyUrl}
              onChange={e => setProxyUrl(e.target.value)}
              placeholder="http://127.0.0.1:7900"
              className="w-full brutal-input px-3.5 py-2 text-sm font-mono font-bold"
            />
            <p className="text-[11px] font-mono font-bold text-[#09090B]/60 mt-1">
              默认优先连接 Clash Verge（7900 端口）或 Shadowrocket（1082 端口）
            </p>
          </div>

          {/* Test Connection */}
          <div className="flex items-center justify-between p-3 bg-[#F8F9FA] border-2 border-[#09090B]">
            <span className="text-xs font-bold text-[#09090B]">检测 API 密钥与代理网络连通状态</span>
            <button
              onClick={handleTest}
              disabled={isTesting || !apiKey.trim()}
              className="brutal-btn px-3 py-1.5 text-xs flex items-center gap-1.5 disabled:opacity-40"
            >
              {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D97706]" /> : null}
              {isTesting ? '正在探测...' : '测试连通性'}
            </button>
          </div>

          {testResult && (
            <div
              className={`p-3 text-xs font-bold flex items-start gap-2 border-2 border-[#09090B] ${
                testResult.success
                  ? 'bg-[#D97706]/15 text-[#09090B]'
                  : 'bg-[#09090B] text-[#FFFFFF]'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-[#D97706] flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-[#D97706] flex-shrink-0 mt-0.5" />
              )}
              <div>{testResult.message}</div>
            </div>
          )}

          {/* LLM Director Engine Selection */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-black text-[#09090B] mb-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#D97706]" />
              AI 导演与台本扩写大模型 (LLM Director Engine)
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setLlmModel('gemini-4-argon')}
                className={`p-3 text-left border-2 border-[#09090B] transition ${
                  llmModel === 'gemini-4-argon'
                    ? 'bg-[#D97706] text-[#FFFFFF] shadow-[3px_3px_0_#09090B]'
                    : 'bg-[#F8F9FA] text-[#09090B]'
                }`}
              >
                <div className="text-xs font-black font-mono">Gemini 4 Argon</div>
                <div className="text-[10px] font-bold opacity-85 mt-0.5">旗舰推理引擎 · 1M 上下文深度创作</div>
              </button>
              <button
                type="button"
                onClick={() => setLlmModel('gemini-3.8-flash')}
                className={`p-3 text-left border-2 border-[#09090B] transition ${
                  llmModel === 'gemini-3.8-flash'
                    ? 'bg-[#D97706] text-[#FFFFFF] shadow-[3px_3px_0_#09090B]'
                    : 'bg-[#F8F9FA] text-[#09090B]'
                }`}
              >
                <div className="text-xs font-black font-mono">Gemini 3.8 Flash</div>
                <div className="text-[10px] font-bold opacity-85 mt-0.5">高速轻量模型 · 快速润色扩写</div>
              </button>
            </div>
          </div>

          {/* TTS Model Selection */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-black text-[#09090B] mb-1.5">
              <Cpu className="w-3.5 h-3.5 text-[#D97706]" />
              默认语音合成引擎 (TTS Engine)
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setDefaultModel('gemini-3.8-flash-tts')}
                className={`p-3 text-left border-2 border-[#09090B] transition ${
                  defaultModel === 'gemini-3.8-flash-tts'
                    ? 'bg-[#D97706] text-[#FFFFFF] shadow-[3px_3px_0_#09090B]'
                    : 'bg-[#F8F9FA] text-[#09090B]'
                }`}
              >
                <div className="text-xs font-black font-mono">Gemini 3.8 Flash TTS</div>
                <div className="text-[10px] font-bold opacity-85 mt-0.5">旗舰高保真 · 顶级表演力</div>
              </button>
              <button
                type="button"
                onClick={() => setDefaultModel('gemini-3.8-flash-lite-tts')}
                className={`p-3 text-left border-2 border-[#09090B] transition ${
                  defaultModel === 'gemini-3.8-flash-lite-tts'
                    ? 'bg-[#D97706] text-[#FFFFFF] shadow-[3px_3px_0_#09090B]'
                    : 'bg-[#F8F9FA] text-[#09090B]'
                }`}
              >
                <div className="text-xs font-black font-mono">Gemini 3.8 Flash-Lite</div>
                <div className="text-[10px] font-bold opacity-85 mt-0.5">极速响应 · 高吞吐低延迟</div>
              </button>
            </div>
          </div>

          {/* Auto play toggle */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs font-black text-[#09090B]">合成完成后自动播放试听</span>
            <input
              type="checkbox"
              checked={autoPlay}
              onChange={e => setAutoPlay(e.target.checked)}
              className="w-4 h-4 border-2 border-[#09090B] accent-[#D97706] cursor-pointer"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t-2 border-[#09090B] bg-[#F8F9FA]">
          <button
            onClick={onClose}
            className="brutal-btn px-4 py-2 text-xs"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="brutal-btn-amber px-5 py-2 text-xs"
          >
            ★ 保存配置
          </button>
        </div>
      </div>
    </div>
  );
}
