import { useState } from 'react';
import { X, Key, Globe, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2, Cpu } from 'lucide-react';
import { AppSettings, ConnectionTestResult } from '../api/types';
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
  const [showKey, setShowKey] = useState(false);

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

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
      defaultModel
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-100">系统与网络设置</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Gemini API Key */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <Key className="w-3.5 h-3.5 text-indigo-400" />
                Google Gemini API Key
              </label>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-indigo-400 hover:underline"
              >
                获取 API Key
              </a>
            </div>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 pr-10 text-sm text-slate-100 font-mono placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Network Proxy */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-1.5">
              <Globe className="w-3.5 h-3.5 text-indigo-400" />
              本地网络代理 (Proxy Server)
            </label>
            <input
              type="text"
              value={proxyUrl}
              onChange={e => setProxyUrl(e.target.value)}
              placeholder="http://127.0.0.1:7900"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-100 font-mono placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              默认优先连接 Clash Verge（7900 端口）或 Shadowrocket（1082 端口）
            </p>
          </div>

          {/* Test Connection Button */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <span className="text-xs text-slate-400">检测当前 API 密钥与代理网络连通度</span>
            <button
              onClick={handleTest}
              disabled={isTesting || !apiKey.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-indigo-300 border border-slate-700 transition disabled:opacity-50"
            >
              {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {isTesting ? '正在探测...' : '测试连通性'}
            </button>
          </div>

          {/* Test result feedback */}
          {testResult && (
            <div
              className={`p-3 rounded-xl text-xs flex items-start gap-2 border ${
                testResult.success
                  ? 'bg-emerald-950/30 border-emerald-800/50 text-emerald-300'
                  : 'bg-rose-950/30 border-rose-800/50 text-rose-300'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              )}
              <div>{testResult.message}</div>
            </div>
          )}

          {/* Model selection */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-1.5">
              <Cpu className="w-3.5 h-3.5 text-indigo-400" />
              默认语音合成模型 (TTS Engine)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDefaultModel('gemini-3.8-flash-tts')}
                className={`p-3 rounded-xl border text-left transition ${
                  defaultModel === 'gemini-3.8-flash-tts'
                    ? 'border-indigo-500 bg-indigo-950/30 text-indigo-200'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="text-xs font-semibold">Gemini 3.8 Flash TTS</div>
                <div className="text-[10px] text-slate-500 mt-0.5">旗舰级高保真·顶级表演力</div>
              </button>
              <button
                type="button"
                onClick={() => setDefaultModel('gemini-3.8-flash-lite-tts')}
                className={`p-3 rounded-xl border text-left transition ${
                  defaultModel === 'gemini-3.8-flash-lite-tts'
                    ? 'border-indigo-500 bg-indigo-950/30 text-indigo-200'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="text-xs font-semibold">Gemini 3.8 Flash-Lite TTS</div>
                <div className="text-[10px] text-slate-500 mt-0.5">极速响应·高吞吐低延迟</div>
              </button>
            </div>
          </div>

          {/* Auto play toggle */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-300">合成完成后自动播放试听</span>
            <input
              type="checkbox"
              checked={autoPlay}
              onChange={e => setAutoPlay(e.target.checked)}
              className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-indigo-500 accent-indigo-600 cursor-pointer"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-800 bg-slate-950/50">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:bg-slate-800 transition"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition"
          >
            保存配置
          </button>
        </div>
      </div>
    </div>
  );
}
