import { useState } from 'react';
import {
  Mic,
  Sparkles,
  Layers,
  History,
  Settings,
  Plus,
  Play,
  RefreshCw,
  Search,
  Wand2,
  Trash2,
  Download,
  AlertCircle,
  Loader2,
  CheckCircle2,
  X
} from 'lucide-react';
import { useVoiceStore } from './hooks/useVoiceStore';
import { WaveformPlayer } from './components/WaveformPlayer';
import { VoiceCard } from './components/VoiceCard';
import { CloneModal } from './components/CloneModal';
import { SettingsModal } from './components/SettingsModal';
import { directScriptWithLLM, synthesizeSpeech } from './api/gemini';
import { storage } from './utils/storage';
import { formatAudioTime } from './utils/audioConverter';

type TabType = 'studio' | 'repository' | 'history';
type SynthesisMode = 'passthrough' | 'director';

const STYLE_PRESETS = [
  { name: '自然平和', prompt: 'calm, natural, and balanced cadence' },
  { name: '喜悦欢快', prompt: 'cheerful, bright, and enthusiastic with smiling tone' },
  { name: '严肃庄重', prompt: 'serious, authoritative, and deliberate tone' },
  { name: '悲伤低沉', prompt: 'melancholic, subdued, and emotionally vulnerable' },
  { name: '激昂有力', prompt: 'passionate, inspiring, and high energy' },
  { name: '神秘轻语', prompt: 'whispering, intimate, and suspenseful' },
  { name: '深夜电台', prompt: 'deep, soothing, slow-paced, warm, and intimate late-night radio host' },
  { name: '影视解说', prompt: 'documentary narrator, engaging, steady, and cinematic' }
];

const TARGET_LANGUAGES = [
  { code: 'zh-CN', name: '中文（普通话）' },
  { code: 'zh-HK', name: '粤语（广东话）' },
  { code: 'en-US', name: '英语（美式）' },
  { code: 'en-GB', name: '英语（英式）' },
  { code: 'ja-JP', name: '日语（日本語）' },
  { code: 'ko-KR', name: '韩语（한국어）' },
  { code: 'fr-FR', name: '法语（Français）' },
  { code: 'de-DE', name: '德语（Deutsch）' },
  { code: 'es-ES', name: '西班牙语（Español）' },
  { code: 'ru-RU', name: '俄语（Русский）' }
];

export function App() {
  const {
    voices,
    selectedVoiceId,
    setSelectedVoiceId,
    history,
    settings,
    isLoading,
    isSyncing,
    updateSettings,
    syncCloudVoices,
    addClonedVoice,
    updateVoiceName,
    toggleFavorite,
    removeVoice,
    addHistoryRecord,
    clearHistory,
    deleteHistoryRecord
  } = useVoiceStore();

  const [activeTab, setActiveTab] = useState<TabType>('studio');
  const [synthesisMode, setSynthesisMode] = useState<SynthesisMode>('passthrough');

  // Synthesis form states
  const [inputText, setInputText] = useState('');
  const [stylePrompt, setStylePrompt] = useState('cheerful, bright, and enthusiastic with smiling tone');
  const [selectedStylePreset, setSelectedStylePreset] = useState('喜悦欢快');

  // Director mode states
  const [directorDraft, setDirectorDraft] = useState('');
  const [targetLang, setTargetLang] = useState('zh-CN');
  const [directorMood, setDirectorMood] = useState('影视叙事，富有感染力');
  const [isDirecting, setIsDirecting] = useState(false);
  const [directorNotes, setDirectorNotes] = useState('');

  // Audio output state
  const [generatedAudioBase64, setGeneratedAudioBase64] = useState<string | null>(null);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthesisError, setSynthesisError] = useState<string | null>(null);

  // Modals
  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  // Sync status message
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(null);

  // Voice repo filter & search
  const [repoFilter, setRepoFilter] = useState<'all' | 'replicated' | 'preset' | 'favorite'>('all');
  const [repoSearch, setRepoSearch] = useState('');

  // History search
  const [historySearch, setHistorySearch] = useState('');

  const currentVoice = voices.find(v => v.id === selectedVoiceId) || voices[0];

  const handleSyncVoices = async () => {
    if (!settings.apiKey) {
      setIsSettingsModalOpen(true);
      return;
    }
    setSyncMessage(null);
    const result = await syncCloudVoices();
    if (result.error) {
      setSyncMessage({ type: 'error', text: `同步失败: ${result.error}` });
    } else if (result.count > 0) {
      setSyncMessage({ type: 'success', text: `成功从 Google 云端同步 ${result.count} 条真实声线！已自动剔除无效历史占位。` });
    } else {
      setSyncMessage({ type: 'info', text: 'Google 云端暂未查询到已保存的克隆声线，请录制并克隆新声线。已自动清理本地无效占位。' });
    }
  };

  // Quick insertion of vocal tags
  const insertTag = (tag: string) => {
    setInputText(prev => {
      const space = prev.length > 0 && !prev.endsWith(' ') ? ' ' : '';
      return `${prev}${space}${tag} `;
    });
  };

  // Run LLM Director
  const handleRunDirector = async () => {
    if (!settings.apiKey) {
      setIsSettingsModalOpen(true);
      return;
    }
    if (!directorDraft.trim()) return;

    setIsDirecting(true);
    setSynthesisError(null);
    try {
      const result = await directScriptWithLLM(
        settings.apiKey,
        directorDraft.trim(),
        targetLang,
        directorMood
      );
      setInputText(result.enhancedText);
      setStylePrompt(result.speechStyle);
      setDirectorNotes(result.directorNotes);
    } catch (err) {
      console.error('Director failed', err);
      setSynthesisError(`导演润色失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsDirecting(false);
    }
  };

  // Run Speech Synthesis
  const handleSynthesize = async () => {
    if (!settings.apiKey) {
      setIsSettingsModalOpen(true);
      return;
    }
    if (!inputText.trim()) return;

    setIsSynthesizing(true);
    setSynthesisError(null);

    try {
      const result = await synthesizeSpeech(settings.apiKey, {
        text: inputText.trim(),
        voiceId: selectedVoiceId,
        stylePrompt: stylePrompt.trim(),
        model: settings.defaultModel
      });

      setGeneratedAudioBase64(result.audioBase64);

      // Add to history
      addHistoryRecord({
        id: `rec_${Date.now()}`,
        timestamp: Date.now(),
        text: inputText.trim(),
        voiceId: selectedVoiceId,
        voiceName: currentVoice?.displayName || selectedVoiceId,
        stylePrompt: stylePrompt.trim(),
        audioBase64: result.audioBase64,
        audioDuration: result.duration,
        model: settings.defaultModel
      });
    } catch (err) {
      console.error('Synthesis failed', err);
      setSynthesisError(`合成失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSynthesizing(false);
    }
  };

  // Export audio
  const handleExportWav = async (base64?: string, defaultTitle = 'synthesized_voice') => {
    const audioData = base64 || generatedAudioBase64;
    if (!audioData) return;
    const filename = `${defaultTitle}_${Date.now()}.wav`;
    await storage.exportAudioFile(audioData, filename);
  };

  // Filter voices for repo
  const filteredVoices = voices.filter(v => {
    if (repoFilter === 'replicated' && v.type !== 'replicated') return false;
    if (repoFilter === 'preset' && v.type !== 'preset') return false;
    if (repoFilter === 'favorite' && !v.isFavorite) return false;
    if (repoSearch.trim()) {
      const q = repoSearch.toLowerCase();
      const matchName = v.displayName.toLowerCase().includes(q);
      const matchId = v.id.toLowerCase().includes(q);
      const matchTags = v.tags?.some(t => t.toLowerCase().includes(q));
      return matchName || matchId || matchTags;
    }
    return true;
  });

  // Filter history
  const filteredHistory = history.filter(item => {
    if (!historySearch.trim()) return true;
    const q = historySearch.toLowerCase();
    return (
      item.text.toLowerCase().includes(q) ||
      item.voiceName.toLowerCase().includes(q) ||
      item.stylePrompt.toLowerCase().includes(q)
    );
  });

  if (isLoading) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-300">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-3" />
        <p className="text-sm font-medium">正在初始化 Voice Clone Studio...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Sidebar Navigation */}
      <aside className="w-64 border-r border-slate-800 bg-slate-900/70 flex flex-col justify-between flex-shrink-0">
        <div>
          {/* Logo and Brand */}
          <div className="p-5 border-b border-slate-800/80 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
              <Mic className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-sm tracking-wide text-white">Voice Clone Studio</h1>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-[10px] text-indigo-400 font-mono">Gemini 3.8 TTS</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              </div>
            </div>
          </div>

          {/* Nav Items */}
          <nav className="p-3 space-y-1.5">
            <button
              onClick={() => setActiveTab('studio')}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition ${
                activeTab === 'studio'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Wand2 className="w-4 h-4" />
              <span>多模态合成工坊</span>
            </button>

            <button
              onClick={() => setActiveTab('repository')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition ${
                activeTab === 'repository'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center gap-3">
                <Layers className="w-4 h-4" />
                <span>我的声线仓库</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-800/80 text-slate-300 font-mono">
                {voices.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('history')}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition ${
                activeTab === 'history'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center gap-3">
                <History className="w-4 h-4" />
                <span>合成历史沉淀</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-800/80 text-slate-300 font-mono">
                {history.length}
              </span>
            </button>
          </nav>

          {/* Quick Clone CTA */}
          <div className="px-3 pt-2">
            <button
              onClick={() => setIsCloneModalOpen(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-600 hover:to-pink-600 text-white text-xs font-bold shadow-lg shadow-indigo-500/20 transition transform active:scale-95"
            >
              <Sparkles className="w-4 h-4" />
              <span>克隆新声线 (Voice Replication)</span>
            </button>
          </div>
        </div>

        {/* Bottom Status & Settings */}
        <div className="p-3 border-t border-slate-800/80 space-y-2">
          {/* Active Voice Pill */}
          <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-xs">
            <div className="text-[10px] text-slate-500 mb-0.5">当前选用声线：</div>
            <div className="font-semibold text-indigo-300 truncate">
              {currentVoice?.displayName || '未选择'}
            </div>
          </div>

          {/* API Key Status & Settings Button */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-1.5 text-[11px]">
              {settings.apiKey ? (
                <span className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" /> API 就绪
                </span>
              ) : (
                <span className="flex items-center gap-1 text-amber-400">
                  <AlertCircle className="w-3.5 h-3.5" /> 未填 API Key
                </span>
              )}
            </div>
            <button
              onClick={() => setIsSettingsModalOpen(true)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
              title="系统设置与代理"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden bg-slate-950">
        {/* Top Header Bar */}
        <header className="h-14 border-b border-slate-800/80 px-6 flex items-center justify-between bg-slate-900/30 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-200">
              {activeTab === 'studio' && '多模态语音合成工作台'}
              {activeTab === 'repository' && '声线资产仓库与声纹管理'}
              {activeTab === 'history' && '语音生成历史归档池'}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {activeTab === 'repository' && (
              <button
                onClick={handleSyncVoices}
                disabled={isSyncing || !settings.apiKey}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 border border-slate-700 transition disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-indigo-400' : ''}`} />
                <span>{isSyncing ? '正在拉取云端...' : '从云端同步声线'}</span>
              </button>
            )}

            <button
              onClick={() => setIsCloneModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white shadow-md transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>克隆声线</span>
            </button>
          </div>
        </header>

        {/* Tab 1: Studio */}
        {activeTab === 'studio' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Top row: Active Voice Card & Mode Switcher */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Selected Voice Card */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-slate-400 font-medium mb-1">正在使用的声线：</div>
                  <div className="text-sm font-bold text-slate-100">{currentVoice?.displayName}</div>
                  <div className="text-[11px] font-mono text-slate-500 mt-0.5">ID: {currentVoice?.id}</div>
                </div>
                <button
                  onClick={() => setActiveTab('repository')}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 font-medium transition border border-slate-700"
                >
                  更换声线
                </button>
              </div>

              {/* Synthesis Mode Switcher */}
              <div className="lg:col-span-2 p-1.5 rounded-xl border border-slate-800 bg-slate-900/40 flex items-center">
                <button
                  onClick={() => setSynthesisMode('passthrough')}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold transition ${
                    synthesisMode === 'passthrough'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  【直通模式】原字直读 + 情绪参数
                </button>
                <button
                  onClick={() => setSynthesisMode('director')}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 ${
                    synthesisMode === 'director'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  【智能导演模式】Gemini 3.8 翻译润色与标签注入
                </button>
              </div>
            </div>

            {/* Mode A: LLM Director Control Box */}
            {synthesisMode === 'director' && (
              <div className="rounded-xl border border-purple-900/50 bg-purple-950/20 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    <span className="text-xs font-bold text-purple-200">
                      Gemini 3.8 Flash 影视配音导演引擎
                    </span>
                  </div>
                  <span className="text-[11px] text-purple-300/80">
                    支持 130 种语言跨语种翻译、电影级扩写与自动注入发音停顿标记
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      目标发音语言 (Target Language)
                    </label>
                    <select
                      value={targetLang}
                      onChange={e => setTargetLang(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      {TARGET_LANGUAGES.map(l => (
                        <option key={l.code} value={l.code}>{l.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                      情绪基调与导演语调氛围
                    </label>
                    <input
                      type="text"
                      value={directorMood}
                      onChange={e => setDirectorMood(e.target.value)}
                      placeholder="例如：影视纪录片旁白、短视频爆单煽动、温暖深夜电台"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    原始草稿台词或灵感想法
                  </label>
                  <textarea
                    rows={2}
                    value={directorDraft}
                    onChange={e => setDirectorDraft(e.target.value)}
                    placeholder="输入需要导演扩写润色的初始文案..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-[11px] text-slate-400">
                    {directorNotes && (
                      <span className="text-purple-300 font-medium">导演批注：{directorNotes}</span>
                    )}
                  </div>
                  <button
                    onClick={handleRunDirector}
                    disabled={isDirecting || !directorDraft.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-md transition disabled:opacity-50"
                  >
                    {isDirecting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>导演正在推敲台词与语气...</span>
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-3.5 h-3.5" />
                        <span>一键导演润色扩写</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Vocal Tags Quick Bar */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-slate-400 font-medium mr-1">快捷插入声音事件：</span>
              {[
                { tag: '<laugh>', label: '笑声' },
                { tag: '<sigh>', label: '叹息' },
                { tag: '<gasp>', label: '倒吸气' },
                { tag: '<cough>', label: '轻咳' },
                { tag: '<throat-clearing>', label: '清嗓' },
                { tag: '<short pause>', label: '短顿(0.3s)' },
                { tag: '<medium pause>', label: '中顿(0.7s)' }
              ].map(item => (
                <button
                  key={item.tag}
                  type="button"
                  onClick={() => insertTag(item.tag)}
                  className="px-2 py-0.5 rounded-md bg-slate-800/80 hover:bg-slate-700 text-[11px] font-mono text-indigo-300 border border-slate-700/60 transition"
                  title={`在光标处插入 ${item.tag}`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* Synthesis Textarea */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-300">
                  朗读台词脚本 (Verbatim Script)
                </label>
                <span className="text-[11px] font-mono text-slate-500">
                  字数：{inputText.length}
                </span>
              </div>
              <textarea
                rows={4}
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                placeholder="在此输入需要合成的台词文本，支持直接内嵌 <laugh>、<sigh>、<short pause> 等发音标签..."
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition leading-relaxed"
              />
            </div>

            {/* Emotion & Speech Style Preset Selector */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
              <div className="text-xs font-semibold text-slate-300">
                情绪与语调风格调节 (Speech Metadata Style)
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {STYLE_PRESETS.map(preset => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => {
                      setSelectedStylePreset(preset.name);
                      setStylePrompt(preset.prompt);
                    }}
                    className={`p-2 rounded-lg border text-left transition ${
                      selectedStylePreset === preset.name
                        ? 'border-indigo-500 bg-indigo-950/40 text-indigo-200'
                        : 'border-slate-800 bg-slate-950/80 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-medium">{preset.name}</div>
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  当前情绪提示指令 (可手动精调)：
                </label>
                <input
                  type="text"
                  value={stylePrompt}
                  onChange={e => {
                    setStylePrompt(e.target.value);
                    setSelectedStylePreset('');
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Error Notification */}
            {synthesisError && (
              <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                <div>{synthesisError}</div>
              </div>
            )}

            {/* Synthesize Action Bar */}
            <div className="flex items-center justify-between pt-2">
              <div className="text-xs text-slate-400">
                选用引擎：<span className="font-mono text-indigo-300">{settings.defaultModel}</span>
              </div>
              <button
                onClick={handleSynthesize}
                disabled={isSynthesizing || !inputText.trim()}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold shadow-lg transition ${
                  isSynthesizing || !inputText.trim()
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30'
                }`}
              >
                {isSynthesizing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Gemini 3.8 TTS 正在渲染声波...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>生成高清语音 (Synthesize)</span>
                  </>
                )}
              </button>
            </div>

            {/* Waveform Canvas Player Component */}
            <div className="pt-2">
              <WaveformPlayer
                audioBase64={generatedAudioBase64}
                title={`${currentVoice?.displayName || '声线'} - 高保真音频`}
                autoPlay={settings.autoPlay}
                onExport={() => handleExportWav(undefined, currentVoice?.displayName)}
              />
            </div>
          </div>
        )}

        {/* Tab 2: Voice Repository */}
        {activeTab === 'repository' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Sync Feedback Message */}
            {syncMessage && (
              <div
                className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 text-xs shadow-md transition-all ${
                  syncMessage.type === 'success'
                    ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-200'
                    : syncMessage.type === 'error'
                    ? 'bg-rose-950/40 border-rose-800/80 text-rose-200'
                    : 'bg-indigo-950/40 border-indigo-800/80 text-indigo-200'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {syncMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
                  {syncMessage.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />}
                  {syncMessage.type === 'info' && <Sparkles className="w-4 h-4 text-indigo-400 flex-shrink-0" />}
                  <span>{syncMessage.text}</span>
                </div>
                <button
                  onClick={() => setSyncMessage(null)}
                  className="p-1 rounded hover:bg-white/10 transition text-slate-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Filter and Search Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              {/* Type Filters */}
              <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800 w-full sm:w-auto">
                <button
                  onClick={() => setRepoFilter('all')}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                    repoFilter === 'all'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  全部声线 ({voices.length})
                </button>
                <button
                  onClick={() => setRepoFilter('replicated')}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                    repoFilter === 'replicated'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  克隆声线 ({voices.filter(v => v.type === 'replicated').length})
                </button>
                <button
                  onClick={() => setRepoFilter('preset')}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                    repoFilter === 'preset'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  官方预设 ({voices.filter(v => v.type === 'preset').length})
                </button>
                <button
                  onClick={() => setRepoFilter('favorite')}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                    repoFilter === 'favorite'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ★ 收藏 ({voices.filter(v => v.isFavorite).length})
                </button>
              </div>

              {/* Search input */}
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={repoSearch}
                  onChange={e => setRepoSearch(e.target.value)}
                  placeholder="搜索声线名称或标签..."
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Grid of Voice Cards */}
            {filteredVoices.length === 0 ? (
              <div className="h-48 rounded-xl border border-dashed border-slate-800 flex flex-col items-center justify-center text-slate-500 text-xs gap-2">
                <div>未找到匹配的声线模型</div>
                <button
                  onClick={() => setIsCloneModalOpen(true)}
                  className="text-indigo-400 hover:underline"
                >
                  + 立即录音克隆一段新声音
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredVoices.map(voice => (
                  <VoiceCard
                    key={voice.id}
                    voice={voice}
                    isSelected={selectedVoiceId === voice.id}
                    onSelect={id => {
                      setSelectedVoiceId(id);
                      setActiveTab('studio');
                    }}
                    onRename={updateVoiceName}
                    onToggleFavorite={toggleFavorite}
                    onDelete={removeVoice}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: History */}
        {activeTab === 'history' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {/* Top controls */}
            <div className="flex items-center justify-between gap-3">
              <div className="relative w-72">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={e => setHistorySearch(e.target.value)}
                  placeholder="搜索历史生成台词..."
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {history.length > 0 && (
                <button
                  onClick={clearHistory}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-rose-400 px-3 py-1.5 rounded-lg hover:bg-slate-900 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>清空全部历史</span>
                </button>
              )}
            </div>

            {filteredHistory.length === 0 ? (
              <div className="h-48 rounded-xl border border-dashed border-slate-800 flex items-center justify-center text-slate-500 text-xs">
                暂无历史生成记录
              </div>
            ) : (
              <div className="space-y-3">
                {filteredHistory.map(item => (
                  <div
                    key={item.id}
                    className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-slate-700 transition space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold text-indigo-300">
                            {item.voiceName}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {new Date(item.timestamp).toLocaleString()}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                            {formatAudioTime(item.audioDuration)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-200 line-clamp-3 leading-relaxed">
                          {item.text}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => {
                            setInputText(item.text);
                            setStylePrompt(item.stylePrompt);
                            setSelectedVoiceId(item.voiceId);
                            setActiveTab('studio');
                          }}
                          className="text-xs px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                          title="载入此文案与配置至工作台"
                        >
                          载入
                        </button>
                        <button
                          onClick={() => handleExportWav(item.audioBase64, item.voiceName)}
                          className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-indigo-300 transition"
                          title="导出 WAV"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteHistoryRecord(item.id)}
                          className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-rose-400 transition"
                          title="删除记录"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Compact Waveform preview for this history item */}
                    <WaveformPlayer
                      audioBase64={item.audioBase64}
                      title={`回放：${item.voiceName}`}
                      onExport={() => handleExportWav(item.audioBase64, item.voiceName)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Clone Voice Modal */}
      <CloneModal
        isOpen={isCloneModalOpen}
        onClose={() => setIsCloneModalOpen(false)}
        onCloneSubmit={addClonedVoice}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={settings}
        onSave={updateSettings}
      />
    </div>
  );
}
