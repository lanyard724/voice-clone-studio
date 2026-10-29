import { useState, useEffect, useRef } from 'react';
import {
  Settings,
  Play,
  RefreshCw,
  Search,
  Wand2,
  Trash2,
  Download,
  AlertCircle,
  Loader2,
  CheckCircle2,
  X,
  Pause
} from 'lucide-react';
import { useVoiceStore } from './hooks/useVoiceStore';
import { WaveformPlayer } from './components/WaveformPlayer';
import { VoiceCard } from './components/VoiceCard';
import { CloneModal } from './components/CloneModal';
import { SettingsModal } from './components/SettingsModal';
import { directScriptWithLLM, synthesizeSpeech } from './api/gemini';
import { storage } from './utils/storage';
import { formatAudioTime } from './utils/audioConverter';

type TabType = 'studio' | 'repository' | 'history' | 'batch';
type SynthesisMode = 'passthrough' | 'director';

const STYLE_PRESETS = [
  { name: '自然平和', prompt: 'calm, natural, and balanced cadence' },
  { name: '深夜电台', prompt: 'deep, soothing, slow-paced, warm, and intimate late-night radio host' },
  { name: '喜悦欢快', prompt: 'cheerful, bright, and enthusiastic with smiling tone' },
  { name: '影视解说', prompt: 'documentary narrator, engaging, steady, and cinematic' },
  { name: '严肃庄重', prompt: 'serious, authoritative, and deliberate tone' },
  { name: '悲伤低沉', prompt: 'melancholic, subdued, and emotionally vulnerable' },
  { name: '激昂有力', prompt: 'passionate, inspiring, and high energy' },
  { name: '神秘轻语', prompt: 'whispering, intimate, and suspenseful' }
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

const QUICK_DRAFTS = [
  { label: '深夜电台开场', mood: '温暖治愈深夜电台主播', text: '聊一聊在喧嚣城市里独自下班回家、戴上耳机那一刻的松弛感。' },
  { label: '硬核科技解读', mood: '节奏干脆、充满洞察力', text: '解析新一代多模态语音合成如何彻底改变个人创作者的内容生产流。' },
  { label: '悬疑纪录旁白', mood: '深沉克制、电影级叙事', text: '在一座被遗忘的北欧声学实验室里，一盘尘封三十年的磁带再次转动。' }
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
    deleteHistoryRecord,
    reloadFromBackend
  } = useVoiceStore();

  const [activeTab, setActiveTab] = useState<TabType>('studio');
  const [synthesisMode, setSynthesisMode] = useState<SynthesisMode>('director');

  // Synthesis form states
  const [inputText, setInputText] = useState(
    '欢迎来到阿岚的先锋黑曜琥珀声音工作站。[short pause] 只需在上方输入一句话灵感，AI 导演即可自动扩写台词并注入细腻的气息标记。[sigh] 每一帧声波均以纯矢量精度实时呈现。'
  );
  const [stylePrompt, setStylePrompt] = useState('deep, soothing, slow-paced, warm, and intimate late-night radio host');
  const [selectedStylePreset, setSelectedStylePreset] = useState('深夜电台');

  // Director mode states
  const [directorDraft, setDirectorDraft] = useState('聊一聊在喧嚣城市里独自下班回家、戴上耳机那一刻的松弛感。');
  const [targetLang, setTargetLang] = useState('zh-CN');
  const [directorMood, setDirectorMood] = useState('温暖治愈深夜电台主播，带自然呼吸停顿');
  const [isDirecting, setIsDirecting] = useState(false);
  const [directorNotes, setDirectorNotes] = useState('');

  // Audio output state
  const [generatedAudioBase64, setGeneratedAudioBase64] = useState<string | null>(null);
  const [shouldAutoPlay, setShouldAutoPlay] = useState(false);
  const [synthesizedVoiceName, setSynthesizedVoiceName] = useState<string | null>(null);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthesisError, setSynthesisError] = useState<string | null>(null);
  const hasAutoSelectedVoiceRef = useRef(false);

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

  // Bridge & Batch state
  const [bridgeConnected, setBridgeConnected] = useState(false);
  const [batchJobs, setBatchJobs] = useState<any[]>([]);
  const [batchTitle, setBatchTitle] = useState('');
  const [batchText, setBatchText] = useState('');
  const [batchChunkSize, setBatchChunkSize] = useState(1000);
  const [batchConcurrency, setBatchConcurrency] = useState(2);

  const currentVoice = voices.find(v => v.id === selectedVoiceId) || voices[0];

  // One-time initial selection of custom replicated voice on startup only (never override manual user selection)
  useEffect(() => {
    if (!hasAutoSelectedVoiceRef.current && voices.length > 0) {
      hasAutoSelectedVoiceRef.current = true;
      if (selectedVoiceId === 'kore') {
        const custom = voices.find(v => v.type === 'replicated');
        if (custom) {
          setSelectedVoiceId(custom.id);
        }
      }
    }
  }, [voices, selectedVoiceId, setSelectedVoiceId]);

  // Prioritize replicated voices at the top of the studio quick-select list (3 cards),
  // and always ensure the currently selected voice from the repository is visible in the 3 slots
  const sortedVoices = [...voices].sort((a, b) => {
    if (a.type === 'replicated' && b.type !== 'replicated') return -1;
    if (a.type !== 'replicated' && b.type === 'replicated') return 1;
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    return 0;
  });
  const topThreeVoices = sortedVoices.slice(0, 3);
  const quickStudioVoices =
    currentVoice && !topThreeVoices.some(v => v.id === currentVoice.id)
      ? [topThreeVoices[0], topThreeVoices[1], currentVoice].filter(Boolean)
      : topThreeVoices;

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
      setSyncMessage({ type: 'success', text: `成功从 Google 云端同步 ${result.count} 条真实克隆声线。` });
    } else {
      setSyncMessage({ type: 'info', text: '云端暂未查询到已保存的克隆声线，请录制并克隆新声线。' });
    }
  };

  const insertTag = (tag: string) => {
    setInputText(prev => {
      const space = prev.length > 0 && !prev.endsWith(' ') ? ' ' : '';
      return `${prev}${space}${tag} `;
    });
  };

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
        directorMood,
        settings.llmModel || 'gemini-4-argon'
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
      setSynthesizedVoiceName(currentVoice?.displayName || selectedVoiceId);
      setShouldAutoPlay(true);

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

  const handleExportWav = async (base64?: string, defaultTitle = 'synthesized_voice') => {
    const audioData = base64 || generatedAudioBase64;
    if (!audioData) return;
    const filename = `${defaultTitle}_${Date.now()}.wav`;
    await storage.exportAudioFile(audioData, filename);
  };

  const fetchBatchJobs = async () => {
    try {
      const res = await fetch('/api/batch');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.jobs)) setBatchJobs(data.jobs);
      }
    } catch {}
  };

  const handleStartBatch = async () => {
    if (!settings.apiKey) {
      setIsSettingsModalOpen(true);
      return;
    }
    if (!batchText.trim()) return;
    try {
      const res = await fetch('/api/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          title: batchTitle.trim() || undefined,
          text: batchText.trim(),
          voiceId: selectedVoiceId,
          stylePrompt: stylePrompt.trim(),
          model: settings.defaultModel,
          chunkSize: batchChunkSize,
          concurrency: batchConcurrency
        })
      });
      if (res.ok) {
        setBatchText('');
        setBatchTitle('');
        await fetchBatchJobs();
      }
    } catch (err) {
      console.error('Failed to start batch', err);
    }
  };

  const handleBatchControl = async (jobId: string, action: 'pause' | 'resume' | 'delete') => {
    try {
      await fetch('/api/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, jobId })
      });
      await fetchBatchJobs();
    } catch {}
  };

  // Keep latest state ref for SSE remote commands
  const liveRef = useRef({
    activeTab,
    synthesisMode,
    inputText,
    stylePrompt,
    selectedStylePreset,
    selectedVoiceId,
    currentVoiceName: currentVoice?.displayName || selectedVoiceId,
    directorDraft,
    targetLang,
    directorMood,
    directorNotes,
    isDirecting,
    isSynthesizing,
    synthesisError,
    hasAudio: Boolean(generatedAudioBase64),
    settings,
    voicesCount: voices.length,
    historyCount: history.length
  });

  useEffect(() => {
    liveRef.current = {
      activeTab,
      synthesisMode,
      inputText,
      stylePrompt,
      selectedStylePreset,
      selectedVoiceId,
      currentVoiceName: currentVoice?.displayName || selectedVoiceId,
      directorDraft,
      targetLang,
      directorMood,
      directorNotes,
      isDirecting,
      isSynthesizing,
      synthesisError,
      hasAudio: Boolean(generatedAudioBase64),
      settings,
      voicesCount: voices.length,
      historyCount: history.length
    };
    const timer = setTimeout(() => {
      fetch('/api/ui-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uiState: {
            ...liveRef.current,
            settings: {
              ...settings,
              apiKey: settings.apiKey ? '***configured***' : ''
            }
          }
        })
      }).catch(() => {});
    }, 300);

    return () => clearTimeout(timer);
  }, [
    activeTab,
    synthesisMode,
    inputText,
    stylePrompt,
    selectedStylePreset,
    selectedVoiceId,
    currentVoice,
    directorDraft,
    targetLang,
    directorMood,
    directorNotes,
    isDirecting,
    isSynthesizing,
    synthesisError,
    generatedAudioBase64,
    settings,
    voices.length,
    history.length
  ]);

  // Connect to SSE Remote Control Bridge (/api/events)
  useEffect(() => {
    fetchBatchJobs();
    if (window.location.search.includes('snapshot=1')) {
      setBridgeConnected(true);
      return;
    }
    const es = new EventSource('/api/events');

    es.addEventListener('connected', () => {
      setBridgeConnected(true);
    });

    es.addEventListener('state-updated', () => {
      reloadFromBackend();
      fetchBatchJobs();
    });

    es.addEventListener('batch-progress', (ev: MessageEvent) => {
      try {
        const updatedJob = JSON.parse(ev.data);
        setBatchJobs(prev => {
          const idx = prev.findIndex(j => j.id === updatedJob.id);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = updatedJob;
            return copy;
          }
          return [updatedJob, ...prev];
        });
      } catch {}
    });

    es.addEventListener('remote-command', async (ev: MessageEvent) => {
      let cmd: any = null;
      try {
        cmd = JSON.parse(ev.data);
      } catch {
        return;
      }
      const { commandId, action, payload = {} } = cmd;
      const sendAck = (ok: boolean, result?: any, error?: string) => {
        fetch('/api/ui-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commandId,
            ok,
            result,
            error,
            uiState: {
              ...liveRef.current,
              settings: {
                ...liveRef.current.settings,
                apiKey: liveRef.current.settings.apiKey ? '***configured***' : ''
              }
            }
          })
        }).catch(() => {});
      };

      try {
        if (action === 'set-ui') {
          if (payload.activeTab) setActiveTab(payload.activeTab);
          if (payload.synthesisMode) setSynthesisMode(payload.synthesisMode);
          if (payload.inputText !== undefined) setInputText(payload.inputText);
          if (payload.stylePrompt !== undefined) setStylePrompt(payload.stylePrompt);
          if (payload.selectedStylePreset !== undefined) {
            setSelectedStylePreset(payload.selectedStylePreset);
            const found = STYLE_PRESETS.find(p => p.name === payload.selectedStylePreset);
            if (found && payload.stylePrompt === undefined) setStylePrompt(found.prompt);
          }
          if (payload.selectedVoiceId) setSelectedVoiceId(payload.selectedVoiceId);
          if (payload.directorDraft !== undefined) setDirectorDraft(payload.directorDraft);
          if (payload.targetLang) setTargetLang(payload.targetLang);
          if (payload.directorMood !== undefined) setDirectorMood(payload.directorMood);
          if (payload.repoFilter) setRepoFilter(payload.repoFilter);
          if (payload.repoSearch !== undefined) setRepoSearch(payload.repoSearch);
          if (payload.historySearch !== undefined) setHistorySearch(payload.historySearch);
          if (payload.isCloneModalOpen !== undefined) setIsCloneModalOpen(Boolean(payload.isCloneModalOpen));
          if (payload.isSettingsModalOpen !== undefined) setIsSettingsModalOpen(Boolean(payload.isSettingsModalOpen));
          if (payload.llmModel) updateSettings({ llmModel: payload.llmModel });
          if (payload.audioBase64) setGeneratedAudioBase64(payload.audioBase64);
          setTimeout(() => sendAck(true, { updated: Object.keys(payload) }), 80);
          return;
        }

        if (action === 'update-settings') {
          await updateSettings(payload);
          setTimeout(() => sendAck(true, { updatedSettings: true }), 80);
          return;
        }

        if (action === 'sync-voices') {
          const res = await syncCloudVoices();
          sendAck(!res.error, res, res.error);
          return;
        }

        if (action === 'trigger-director') {
          const draft = (payload.draft ?? liveRef.current.directorDraft).trim();
          const lang = payload.targetLang || liveRef.current.targetLang;
          const mood = payload.mood || liveRef.current.directorMood;
          const llmModelToUse = payload.llmModel || liveRef.current.settings.llmModel || 'gemini-4-argon';
          const key = payload.apiKey || liveRef.current.settings.apiKey;
          if (!key) {
            sendAck(false, undefined, '未配置 Gemini API Key');
            return;
          }
          if (!draft) {
            sendAck(false, undefined, '导演草稿内容为空');
            return;
          }
          setActiveTab('studio');
          setSynthesisMode('director');
          setDirectorDraft(draft);
          setIsDirecting(true);
          setSynthesisError(null);
          try {
            const res = await directScriptWithLLM(key, draft, lang, mood, llmModelToUse);
            setInputText(res.enhancedText);
            setStylePrompt(res.speechStyle);
            setDirectorNotes(res.directorNotes);
            sendAck(true, res);
          } catch (e: any) {
            const msg = e?.message || String(e);
            setSynthesisError(`导演润色失败: ${msg}`);
            sendAck(false, undefined, msg);
          } finally {
            setIsDirecting(false);
          }
          return;
        }

        if (action === 'trigger-synthesize') {
          const textToUse = (payload.text ?? liveRef.current.inputText).trim();
          const voiceToUse = payload.voiceId || liveRef.current.selectedVoiceId;
          const styleToUse = (payload.stylePrompt ?? liveRef.current.stylePrompt).trim();
          const modelToUse = payload.model || liveRef.current.settings.defaultModel;
          const key = payload.apiKey || liveRef.current.settings.apiKey;
          if (!key) {
            sendAck(false, undefined, '未配置 Gemini API Key');
            return;
          }
          if (!textToUse) {
            sendAck(false, undefined, '合成文本为空');
            return;
          }
          setActiveTab('studio');
          setInputText(textToUse);
          setSelectedVoiceId(voiceToUse);
          setStylePrompt(styleToUse);
          setIsSynthesizing(true);
          setSynthesisError(null);
          try {
            const res = await synthesizeSpeech(key, {
              text: textToUse,
              voiceId: voiceToUse,
              stylePrompt: styleToUse,
              model: modelToUse
            });
            const matchedVoice = voices.find(v => v.id === voiceToUse);
            const resolvedVoiceName = matchedVoice?.displayName || voiceToUse;
            setGeneratedAudioBase64(res.audioBase64);
            setSynthesizedVoiceName(resolvedVoiceName);
            setShouldAutoPlay(true);
            addHistoryRecord({
              id: `rec_${Date.now()}`,
              timestamp: Date.now(),
              text: textToUse,
              voiceId: voiceToUse,
              voiceName: resolvedVoiceName,
              stylePrompt: styleToUse,
              audioBase64: res.audioBase64,
              audioDuration: res.duration,
              model: modelToUse
            });
            sendAck(true, { duration: res.duration, voiceId: voiceToUse, textLength: textToUse.length });
          } catch (e: any) {
            const msg = e?.message || String(e);
            setSynthesisError(`合成失败: ${msg}`);
            sendAck(false, undefined, msg);
          } finally {
            setIsSynthesizing(false);
          }
          return;
        }

        sendAck(false, undefined, `未知指令: ${action}`);
      } catch (err: any) {
        sendAck(false, undefined, err?.message || String(err));
      }
    });

    es.onerror = () => {
      setBridgeConnected(false);
    };

    return () => {
      es.close();
    };
  }, [reloadFromBackend, syncCloudVoices, updateSettings, addHistoryRecord]);

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
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-[#F8F9FA] text-[#09090B]">
        <div className="brutal-box p-6 flex items-center gap-4">
          <Loader2 className="w-6 h-6 animate-spin text-[#D97706]" />
          <span className="font-mono font-black text-base">INITIALIZING VOICE CLONE STUDIO...</span>
        </div>
      </div>
    );
  }

  const latestHistoryItem = history[0];
  const activeMonitorBase64 = generatedAudioBase64 || latestHistoryItem?.audioBase64 || null;
  const activeMonitorUrl = !generatedAudioBase64 ? latestHistoryItem?.audioUrl || null : null;
  const activeMonitorVoiceLabel = generatedAudioBase64
    ? synthesizedVoiceName || currentVoice?.displayName || '阿岚日常'
    : latestHistoryItem?.voiceName || currentVoice?.displayName || '阿岚日常';
  const activeMonitorTitle = `${activeMonitorVoiceLabel} (24kHz)`;

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#F8F9FA] text-[#09090B] flex flex-col p-6 gap-5 select-none">
      {/* =====================================================================
          TOP COMMAND MATRIX (Strictly Aligned 12-Column Grid: 4 + 5 + 3)
         ===================================================================== */}
      <header className="grid grid-cols-12 gap-5 flex-shrink-0">
        {/* Col 1-4: Brand Identity (Flush with Left Studio Column) */}
        <div className="col-span-12 lg:col-span-4 brutal-box px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 bg-[#D97706] border-2 border-[#09090B] shadow-[2.5px_2.5px_0_#09090B] flex items-center justify-center text-[#FFFFFF] font-mono font-black text-xl">
              V
            </div>
            <div>
              <div className="text-xl font-black tracking-tight text-[#09090B] leading-tight">
                VOICE CLONE STUDIO
              </div>
              <div className="font-mono text-xs font-black text-[#D97706] flex items-center gap-1.5 mt-0.5">
                <span className="inline-block w-2 h-2 bg-[#D97706] border border-[#09090B]" />
                <span>GEMINI 4 ARGON // 3.8 TTS</span>
              </div>
            </div>
          </div>

          <button
            onClick={() => setIsSettingsModalOpen(true)}
            className="brutal-btn px-3 py-2 text-xs font-mono font-black flex items-center gap-1.5"
            title="系统与代理配置"
          >
            <Settings className="w-4 h-4" />
            <span>设置</span>
          </button>
        </div>

        {/* Col 5-9: Primary Navigation Tabs */}
        <div className="col-span-12 lg:col-span-5 brutal-box px-4 py-3 flex items-center justify-between gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('studio')}
            className={`flex-1 py-2.5 px-3 text-sm font-black whitespace-nowrap ${
              activeTab === 'studio' ? 'brutal-btn-amber' : 'brutal-btn'
            }`}
          >
            01 合成工作台
          </button>
          <button
            onClick={() => setActiveTab('repository')}
            className={`flex-1 py-2.5 px-3 text-sm font-black whitespace-nowrap ${
              activeTab === 'repository' ? 'brutal-btn-amber' : 'brutal-btn'
            }`}
          >
            02 声线库 [{voices.length}]
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-2.5 px-3 text-sm font-black whitespace-nowrap ${
              activeTab === 'history' ? 'brutal-btn-amber' : 'brutal-btn'
            }`}
          >
            03 历史 [{history.length}]
          </button>
          <button
            onClick={() => setActiveTab('batch')}
            className={`flex-1 py-2.5 px-3 text-sm font-black whitespace-nowrap ${
              activeTab === 'batch' ? 'brutal-btn-amber' : 'brutal-btn'
            }`}
          >
            04 批处理 [10H+]
          </button>
        </div>

        {/* Col 10-12: Primary Clone CTA & Cloud Sync (Flush with Right Studio Column) */}
        <div className="col-span-12 lg:col-span-3 flex items-stretch gap-3">
          <button
            onClick={handleSyncVoices}
            disabled={isSyncing}
            className="brutal-box px-4 flex items-center justify-center gap-1.5 text-sm font-black hover:bg-[#D97706]/15 disabled:opacity-50"
            title="从 Google Cloud 同步真实克隆声线"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin text-[#D97706]' : ''}`} />
            <span>同步</span>
          </button>

          <button
            onClick={() => setIsCloneModalOpen(true)}
            className="flex-1 brutal-btn-ink px-4 flex items-center justify-center gap-2 text-sm font-black tracking-wide"
          >
            <span className="text-[#D97706] text-base">★</span>
            <span>+ 克隆新声线</span>
          </button>
        </div>
      </header>

      {/* =====================================================================
          TAB 01: STUDIO WORKSPACE (Symmetric 12-Col Grid: 4 Left + 8 Right)
         ===================================================================== */}
      {activeTab === 'studio' && (
        <main className="flex-1 grid grid-cols-12 gap-5 min-h-0 animate-panel-enter">
          {/* LEFT COLUMN (Col 1-4): 01 Voice & Emotion Style Matrix */}
          <section className="col-span-12 lg:col-span-4 brutal-box p-5 flex flex-col justify-between min-h-0 overflow-hidden">
            <div className="space-y-3.5">
              {/* Section 01 Header */}
              <div className="flex items-center justify-between border-b-2 border-[#09090B] pb-2.5">
                <div className="flex items-baseline gap-2.5">
                  <span className="font-mono text-2xl font-black text-[#D97706] leading-none">
                    01
                  </span>
                  <h2 className="text-lg font-black text-[#09090B]">
                    声线与情绪风格配置
                  </h2>
                </div>
                <button
                  onClick={() => setActiveTab('repository')}
                  className="brutal-btn px-3 py-1 text-xs font-mono font-black"
                >
                  全部 [{voices.length}] →
                </button>
              </div>

              {/* Voice Cartridge List (3 Balanced Slots) */}
              <div className="space-y-2">
                {quickStudioVoices.map(v => {
                  const isSel = v.id === selectedVoiceId;
                  return (
                    <button
                      type="button"
                      key={v.id}
                      onClick={() => setSelectedVoiceId(v.id)}
                      className={`w-full text-left p-3 border-2 border-[#09090B] rounded-[5px] cursor-pointer transition-all ${
                        isSel
                          ? 'bg-[#D97706]/15 shadow-[3px_3px_0_#09090B] translate-x-[-1px] translate-y-[-1px]'
                          : 'bg-[#F8F9FA] hover:bg-[#FFFFFF] hover:shadow-[2.5px_2.5px_0_#09090B]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-black text-base text-[#09090B] truncate">
                          {v.displayName}
                          {v.type === 'replicated' ? ' · 专属克隆' : ''}
                        </span>
                        {isSel ? (
                          <span className="px-2.5 py-0.5 bg-[#D97706] text-[#FFFFFF] border-2 border-[#09090B] font-mono text-xs font-black">
                            ★ ACTIVE
                          </span>
                        ) : (
                          <span className="font-mono text-xs font-black px-2 py-0.5 bg-[#FFFFFF] border border-[#09090B] text-[#09090B]">
                            {v.type === 'replicated' ? 'CLONED' : 'PREBUILT'}
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-xs font-bold text-[#09090B]/70 mt-0.5 truncate">
                        ID: {v.id} · 24kHz PCM
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Style Matrix Presets */}
              <div className="pt-0.5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-black text-[#09090B]">
                    情绪风格矩阵 (STYLE MATRIX)
                  </span>
                  <span className="font-mono text-xs font-black text-[#D97706]">
                    8 PRESETS
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {STYLE_PRESETS.map(preset => {
                    const isPresetActive = selectedStylePreset === preset.name;
                    return (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => {
                          setSelectedStylePreset(preset.name);
                          setStylePrompt(preset.prompt);
                        }}
                        className={`py-2 px-3 text-sm font-black text-center ${
                          isPresetActive ? 'brutal-btn-amber' : 'brutal-btn'
                        }`}
                      >
                        {isPresetActive ? `★ ${preset.name}` : preset.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Editable Style Prompt Vector (2-row textarea to prevent horizontal truncation and balance vertical rhythm) */}
              <div>
                <label className="block text-xs font-black text-[#09090B] mb-1.5">
                  当前情绪导演提示词 (STYLE PROMPT)：
                </label>
                <textarea
                  rows={2}
                  value={stylePrompt}
                  onChange={e => {
                    setStylePrompt(e.target.value);
                    setSelectedStylePreset('');
                  }}
                  className="w-full brutal-input px-3 py-2 text-sm font-mono font-bold leading-snug resize-none"
                />
              </div>
            </div>

            {/* Bottom Telemetry Status Box (Flush with Bottom of Right Column) */}
            <div
              onClick={() => setIsSettingsModalOpen(true)}
              className="p-3 border-2 border-[#09090B] rounded-[5px] bg-[#F8F9FA] hover:bg-[#D97706]/12 cursor-pointer transition flex items-center justify-between font-mono text-xs font-black"
              title="点击打开系统与代理设置"
            >
              <div className="flex items-center gap-2 truncate">
                <span className="inline-block w-2.5 h-2.5 bg-[#D97706] border border-[#09090B]" />
                <span className="truncate">
                  {bridgeConnected ? 'SSE 桥接在线' : '本地直连'} // {settings.apiKey ? 'API 已就绪' : '未配置 KEY'}
                </span>
              </div>
              <span className="text-[#D97706] flex-shrink-0">配置 →</span>
            </div>
          </section>

          {/* RIGHT COLUMN (Col 5-12): Balanced 3-Deck Stack (02 AI Director + 03 Compact Script + 04 Vector Monitor) */}
          <section className="col-span-12 lg:col-span-8 flex flex-col gap-5 min-h-0">
            {/* DECK 02: AI Director & Script Expansion Console (First-Class Citizen) */}
            <div className="brutal-box p-5 space-y-3.5 flex-shrink-0">
              <div className="flex items-center justify-between gap-3 border-b-2 border-[#09090B] pb-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-2xl font-black text-[#D97706] leading-none">
                    02
                  </span>
                  <h2 className="text-lg font-black text-[#09090B]">
                    AI 灵感导演与台词扩写引擎
                  </h2>
                  <button
                    type="button"
                    onClick={() =>
                      updateSettings({
                        llmModel:
                          (settings.llmModel || 'gemini-4-argon') === 'gemini-4-argon'
                            ? 'gemini-3.8-flash'
                            : 'gemini-4-argon'
                      })
                    }
                    title="点击切换 AI 导演大语言模型 (Gemini 4 Argon / Gemini 3.8 Flash)"
                    className="px-2.5 py-0.5 bg-[#D97706] text-[#FFFFFF] border-2 border-[#09090B] font-mono text-xs font-black shadow-[2px_2px_0_#09090B] hover:translate-x-[-1px] hover:translate-y-[-1px] transition cursor-pointer"
                  >
                    ★ {(settings.llmModel || 'gemini-4-argon').toUpperCase()}
                  </button>
                </div>

                {/* Quick Inspiration Preset Pills */}
                <div className="flex items-center gap-2">
                  {QUICK_DRAFTS.map(item => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        setDirectorDraft(item.text);
                        setDirectorMood(item.mood);
                      }}
                      className="brutal-btn px-3 py-1.5 text-xs font-black"
                    >
                      ✦ {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Row 1: Language (4 cols) + Narrative Mood (8 cols) */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-4">
                  <label className="block text-xs font-black text-[#09090B] mb-1">
                    目标发音语种 (TARGET LANGUAGE)
                  </label>
                  <select
                    value={targetLang}
                    onChange={e => setTargetLang(e.target.value)}
                    className="w-full brutal-input px-3 py-2 text-sm font-bold h-[40px]"
                  >
                    {TARGET_LANGUAGES.map(l => (
                      <option key={l.code} value={l.code}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-8">
                  <label className="block text-xs font-black text-[#09090B] mb-1">
                    导演叙事基调与语感氛围 (DIRECTOR MOOD)
                  </label>
                  <input
                    type="text"
                    value={directorMood}
                    onChange={e => setDirectorMood(e.target.value)}
                    placeholder="例如：温暖深夜电台、硬核科技解说"
                    className="w-full brutal-input px-3.5 py-2 text-sm font-bold h-[40px]"
                  />
                </div>
              </div>

              {/* Row 2: Full-Width Inspiration Outline + AI Expand CTA */}
              <div>
                <label className="block text-xs font-black text-[#09090B] mb-1">
                  一句话灵感或草稿大纲（由 {settings.llmModel === 'gemini-3.8-flash' ? 'Gemini 3.8 Flash' : 'Gemini 4 Argon'} 自动扩写为带呼吸停顿的完整配音台本）
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={directorDraft}
                    onChange={e => setDirectorDraft(e.target.value)}
                    placeholder={`输入灵感想法，交由 ${settings.llmModel === 'gemini-3.8-flash' ? 'Gemini 3.8 Flash' : 'Gemini 4 Argon'} 扩写为完整台词...`}
                    className="flex-1 brutal-input px-3.5 py-2 text-sm font-bold h-[42px]"
                  />
                  <button
                    type="button"
                    onClick={handleRunDirector}
                    disabled={isDirecting || !directorDraft.trim()}
                    className="brutal-btn-amber px-6 h-[42px] text-sm font-black flex items-center gap-2 whitespace-nowrap disabled:opacity-40"
                  >
                    {isDirecting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>正在扩写...</span>
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-4 h-4" />
                        <span>★ AI 导演扩写台本</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* DECK 03: Final Script & Vocal Tag Fine-Tuning (Tight, Balanced 2-Line Proportion) */}
            <div className="brutal-box p-5 flex-1 flex flex-col justify-between min-h-0">
              <div className="flex items-center justify-between gap-3 border-b-2 border-[#09090B] pb-2.5">
                <div className="flex items-baseline gap-2.5">
                  <span className="font-mono text-2xl font-black text-[#D97706] leading-none">
                    03
                  </span>
                  <h2 className="text-lg font-black text-[#09090B]">
                    最终合成台本与副语言指令
                  </h2>
                  {directorNotes && (
                    <span className="text-xs font-bold text-[#D97706] ml-2">
                      ★ {directorNotes}
                    </span>
                  )}
                </div>

                {/* Large Legible Vocal Tag Buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  {[
                    { tag: '[sigh]', label: '+ [sigh] 轻叹' },
                    { tag: '[laugh]', label: '+ [laugh] 轻笑' },
                    { tag: '[short pause]', label: '+ [short pause] 停顿' },
                    { tag: '[whispering]', label: '+ [whispering] 耳语' }
                  ].map((item, idx) => (
                    <button
                      key={item.tag}
                      type="button"
                      onClick={() => insertTag(item.tag)}
                      className={`px-3 py-1.5 text-xs font-mono font-black border-2 border-[#09090B] rounded-[4px] transition hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[2.5px_2.5px_0_#09090B] active:translate-x-[1px] active:translate-y-[1px] ${
                        idx < 2 ? 'bg-[#D97706]/15 text-[#09090B]' : 'bg-[#F8F9FA] text-[#09090B]'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Balanced Script Box */}
              <div className="my-3 flex-1 flex flex-col min-h-[76px]">
                <textarea
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  rows={2}
                  placeholder="AI 导演扩写后的台本将自动填入此处，你也可以直接微调词句或插入 [sigh]、[short pause] 等副语言标记..."
                  className="w-full flex-1 brutal-input p-3.5 text-base font-bold leading-relaxed resize-none select-text"
                />
              </div>

              {synthesisError && (
                <div className="mb-3 p-3 bg-[#09090B] text-[#FFFFFF] border-2 border-[#09090B] text-sm font-mono font-bold flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-[#D97706] flex-shrink-0" />
                    <span>{synthesisError}</span>
                  </div>
                  <button onClick={() => setSynthesisError(null)} className="text-[#D97706] font-black">
                    ✕
                  </button>
                </div>
              )}

              {/* Bottom Action Bar (Single Horizontal Line) */}
              <div className="flex items-center justify-between gap-4 pt-1">
                <div className="font-mono text-sm font-black text-[#09090B] truncate">
                  字数: <span className="text-[#D97706]">{inputText.length}</span> 字 // 单次 10m55s // LLM: <span className="text-[#D97706]">{settings.llmModel || 'gemini-4-argon'}</span> // TTS: {settings.defaultModel}
                </div>

                <button
                  onClick={handleSynthesize}
                  disabled={isSynthesizing || !inputText.trim()}
                  className="brutal-btn-amber px-6 py-2.5 text-sm font-black flex items-center gap-2 whitespace-nowrap flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSynthesizing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>正在合成 24kHz 声波...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" />
                      <span>立即合成真实语音 (SYNTHESIZE)</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* DECK 04: Vector Tube Monitor Waveform Player */}
            <WaveformPlayer
              audioBase64={activeMonitorBase64}
              audioUrl={activeMonitorUrl}
              title={activeMonitorTitle}
              durationHint={latestHistoryItem?.audioDuration || 29.12}
              autoPlay={settings.autoPlay && shouldAutoPlay}
              onAutoPlayHandled={() => setShouldAutoPlay(false)}
              onExport={() =>
                handleExportWav(
                  activeMonitorBase64 || activeMonitorUrl || undefined,
                  activeMonitorVoiceLabel || 'voice'
                )
              }
            />
          </section>
        </main>
      )}

      {/* =====================================================================
          TAB 02: VOICE REPOSITORY
         ===================================================================== */}
      {activeTab === 'repository' && (
        <main className="flex-1 brutal-box p-6 flex flex-col gap-5 min-h-0 overflow-y-auto animate-panel-enter">
          {syncMessage && (
            <div className="p-4 bg-[#D97706]/15 border-2 border-[#09090B] flex items-center justify-between gap-3 text-sm font-bold text-[#09090B]">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#D97706] flex-shrink-0" />
                <span>{syncMessage.text}</span>
              </div>
              <button onClick={() => setSyncMessage(null)} className="brutal-btn px-2.5 py-1 text-xs">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-[#09090B] pb-4">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-mono text-2xl font-black text-[#D97706] mr-2">02</span>
              <button
                onClick={() => setRepoFilter('all')}
                className={`px-4 py-2 text-sm font-mono ${
                  repoFilter === 'all' ? 'brutal-btn-amber' : 'brutal-btn'
                }`}
              >
                全部声线 [{voices.length}]
              </button>
              <button
                onClick={() => setRepoFilter('replicated')}
                className={`px-4 py-2 text-sm font-mono ${
                  repoFilter === 'replicated' ? 'brutal-btn-amber' : 'brutal-btn'
                }`}
              >
                专属克隆 [{voices.filter(v => v.type === 'replicated').length}]
              </button>
              <button
                onClick={() => setRepoFilter('preset')}
                className={`px-4 py-2 text-sm font-mono ${
                  repoFilter === 'preset' ? 'brutal-btn-amber' : 'brutal-btn'
                }`}
              >
                官方预设 [{voices.filter(v => v.type === 'preset').length}]
              </button>
              <button
                onClick={() => setRepoFilter('favorite')}
                className={`px-4 py-2 text-sm font-mono ${
                  repoFilter === 'favorite' ? 'brutal-btn-amber' : 'brutal-btn'
                }`}
              >
                ★ 收藏 [{voices.filter(v => v.isFavorite).length}]
              </button>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-72">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#09090B]/60" />
                <input
                  type="text"
                  value={repoSearch}
                  onChange={e => setRepoSearch(e.target.value)}
                  placeholder="搜索声线名称或 ID..."
                  className="w-full brutal-input pl-9 pr-3.5 py-2 text-sm font-bold"
                />
              </div>
              <button
                onClick={handleSyncVoices}
                disabled={isSyncing}
                className="brutal-btn px-4 py-2 text-sm font-mono flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin text-[#D97706]' : ''}`} />
                <span>同步云端声线</span>
              </button>
            </div>
          </div>

          {filteredVoices.length === 0 ? (
            <div className="h-56 border-2 border-dashed border-[#09090B] bg-[#F8F9FA] flex flex-col items-center justify-center gap-3">
              <div className="font-mono text-sm font-bold text-[#09090B]/65">未找到匹配的声线模型</div>
              <button
                onClick={() => setIsCloneModalOpen(true)}
                className="brutal-btn-amber px-5 py-2.5 text-sm font-mono"
              >
                ★ + 立即录音克隆新声线
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
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
        </main>
      )}

      {/* =====================================================================
          TAB 03: SYNTHESIS HISTORY ARCHIVE
         ===================================================================== */}
      {activeTab === 'history' && (
        <main className="flex-1 brutal-box p-6 flex flex-col gap-5 min-h-0 overflow-y-auto animate-panel-enter">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[#09090B] pb-4">
            <div className="flex items-baseline gap-2.5">
              <span className="font-mono text-2xl font-black text-[#D97706]">03</span>
              <h2 className="text-lg font-black text-[#09090B]">
                合成历史母带沉淀 ({history.length})
              </h2>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative w-72">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#09090B]/60" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={e => setHistorySearch(e.target.value)}
                  placeholder="搜索历史生成台词或声线..."
                  className="w-full brutal-input pl-9 pr-3.5 py-2 text-sm font-bold"
                />
              </div>

              {history.length > 0 && (
                <button
                  onClick={clearHistory}
                  className="brutal-btn px-4 py-2 text-sm font-mono flex items-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>清空全部</span>
                </button>
              )}
            </div>
          </div>

          {filteredHistory.length === 0 ? (
            <div className="h-56 border-2 border-dashed border-[#09090B] bg-[#F8F9FA] flex items-center justify-center font-mono text-sm font-bold text-[#09090B]/65">
              暂无历史生成记录
            </div>
          ) : (
            <div className="space-y-4">
              {filteredHistory.map(item => (
                <div
                  key={item.id}
                  className="brutal-card p-5 bg-[#F8F9FA] space-y-3.5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2.5 flex-wrap font-mono">
                        <span className="px-2.5 py-1 bg-[#D97706] text-[#FFFFFF] border-2 border-[#09090B] text-xs font-black">
                          {item.voiceName}
                        </span>
                        <span className="text-xs font-bold text-[#09090B]/70">
                          {new Date(item.timestamp).toLocaleString()}
                        </span>
                        <span className="px-2.5 py-1 bg-[#FFFFFF] text-[#09090B] border-2 border-[#09090B] text-xs font-black">
                          {formatAudioTime(item.audioDuration)}
                        </span>
                      </div>
                      <p className="text-base font-bold text-[#09090B] leading-relaxed select-text pt-1">
                        {item.text}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => {
                          setInputText(item.text);
                          setStylePrompt(item.stylePrompt);
                          setSelectedVoiceId(item.voiceId);
                          setActiveTab('studio');
                        }}
                        className="brutal-btn px-3.5 py-2 text-sm font-mono"
                        title="载入此文案与配置至工作台"
                      >
                        载入工作台 →
                      </button>
                      <button
                        onClick={() => handleExportWav(item.audioBase64 || item.audioUrl, item.voiceName)}
                        className="brutal-btn-amber p-2.5"
                        title="导出 WAV"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteHistoryRecord(item.id)}
                        className="brutal-btn p-2.5"
                        title="删除记录"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <WaveformPlayer
                    compact
                    audioBase64={item.audioBase64}
                    audioUrl={item.audioUrl}
                    title={`${item.id}.wav · ${item.voiceName}`}
                    onExport={() => handleExportWav(item.audioBase64 || item.audioUrl, item.voiceName)}
                  />
                </div>
              ))}
            </div>
          )}
        </main>
      )}

      {/* =====================================================================
          TAB 04: 10H+ LONG-AUDIO BATCH ENGINE
         ===================================================================== */}
      {activeTab === 'batch' && (
        <main className="flex-1 brutal-box p-6 flex flex-col gap-6 min-h-0 overflow-y-auto animate-panel-enter">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-[#09090B] pb-4">
            <div className="flex items-baseline gap-2.5">
              <span className="font-mono text-2xl font-black text-[#D97706]">04</span>
              <div>
                <h2 className="text-lg font-black text-[#09090B]">
                  超长音频断点续传批处理引擎 (10h+)
                </h2>
                <p className="text-sm font-bold text-[#09090B]/70 mt-0.5">
                  智能按章节与句号切块，每块实时落盘至 data/batches/，支持断网续传与 FFmpeg 全自动无损拼接
                </p>
              </div>
            </div>

            <div className="px-4 py-2 bg-[#D97706]/15 border-2 border-[#09090B] font-mono text-sm font-black">
              当前声线: <span className="text-[#D97706]">{currentVoice?.displayName}</span> ({selectedVoiceId})
            </div>
          </div>

          <div className="brutal-card p-5 bg-[#F8F9FA] space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block font-mono text-xs font-black text-[#09090B] mb-1.5">
                  BATCH TITLE // 任务名称
                </label>
                <input
                  type="text"
                  value={batchTitle}
                  onChange={e => setBatchTitle(e.target.value)}
                  placeholder="例如：有声书第一卷_15小时"
                  className="w-full brutal-input px-3.5 py-2.5 text-sm font-bold"
                />
              </div>
              <div>
                <label className="block font-mono text-xs font-black text-[#09090B] mb-1.5">
                  CHUNK SIZE // 单块最大字数 (800-1200)
                </label>
                <input
                  type="number"
                  value={batchChunkSize}
                  onChange={e => setBatchChunkSize(Number(e.target.value) || 1000)}
                  min={200}
                  max={2500}
                  className="w-full brutal-input px-3.5 py-2.5 text-sm font-mono font-bold"
                />
              </div>
              <div>
                <label className="block font-mono text-xs font-black text-[#09090B] mb-1.5">
                  CONCURRENCY // 并发通道数 (1-5)
                </label>
                <input
                  type="number"
                  value={batchConcurrency}
                  onChange={e => setBatchConcurrency(Math.max(1, Math.min(5, Number(e.target.value) || 2)))}
                  min={1}
                  max={5}
                  className="w-full brutal-input px-3.5 py-2.5 text-sm font-mono font-bold"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5 font-mono text-xs font-black">
                <span>LONG-FORM MANUSCRIPT // 粘贴十万字以上长文（或通过 CLI 传入 .txt）</span>
                <span className="text-[#D97706]">
                  {batchText.length} 字 // 预计切分 {batchText.trim() ? Math.ceil(batchText.length / batchChunkSize) : 0} 块
                </span>
              </div>
              <textarea
                value={batchText}
                onChange={e => setBatchText(e.target.value)}
                rows={5}
                placeholder="在此粘贴长篇小说、有声书讲稿或长视频旁白文案..."
                className="w-full brutal-input p-4 text-base font-bold leading-relaxed select-text"
              />
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleStartBatch}
                disabled={!batchText.trim()}
                className="brutal-btn-amber px-6 py-3 text-sm font-mono flex items-center gap-2 disabled:opacity-40"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>▶ 启动后台断点续传批处理</span>
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="font-mono text-sm font-black uppercase tracking-wider text-[#09090B]">
              BATCH QUEUE // 批处理任务队列 [{batchJobs.length}]
            </h3>
            {batchJobs.length === 0 ? (
              <div className="h-36 border-2 border-dashed border-[#09090B] bg-[#F8F9FA] flex items-center justify-center font-mono text-sm font-bold text-[#09090B]/65">
                暂无批处理任务（可通过上方表单或 node cli.mjs batch 创建）
              </div>
            ) : (
              batchJobs.map(job => {
                const pct = job.totalChunks > 0 ? Math.round((job.completedChunks / job.totalChunks) * 100) : 0;
                return (
                  <div key={job.id} className="brutal-card p-5 bg-[#FFFFFF] space-y-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 flex-wrap font-mono">
                        <span className="text-base font-black text-[#09090B]">{job.title}</span>
                        <span className="text-xs font-bold text-[#09090B]/65">({job.id})</span>
                        <span
                          className={`text-xs px-2.5 py-0.5 border-2 border-[#09090B] font-black ${
                            job.status === 'completed' || job.status === 'running'
                              ? 'bg-[#D97706] text-[#FFFFFF]'
                              : 'bg-[#09090B] text-[#FFFFFF]'
                          }`}
                        >
                          {job.status.toUpperCase()}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {job.status === 'running' && (
                          <button
                            onClick={() => handleBatchControl(job.id, 'pause')}
                            className="brutal-btn px-3.5 py-1.5 text-sm font-mono flex items-center gap-1.5"
                          >
                            <Pause className="w-4 h-4" /> 暂停
                          </button>
                        )}
                        {(job.status === 'paused' || job.status === 'failed' || job.status === 'queued') && (
                          <button
                            onClick={() => handleBatchControl(job.id, 'resume')}
                            className="brutal-btn-amber px-3.5 py-1.5 text-sm font-mono flex items-center gap-1.5"
                          >
                            <Play className="w-4 h-4 fill-current" /> 断点续传
                          </button>
                        )}
                        <button
                          onClick={() => handleBatchControl(job.id, 'delete')}
                          className="brutal-btn p-2"
                          title="删除任务与切片"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="w-full h-4 bg-[#F8F9FA] border-2 border-[#09090B] overflow-hidden">
                      <div
                        className="h-full bg-[#D97706] transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between font-mono text-xs font-bold text-[#09090B]/80 gap-2">
                      <span>
                        进度: {job.completedChunks} / {job.totalChunks} 切片 ({pct}%) // 总字数: {job.totalChars} // 声线: {job.voiceId}
                      </span>
                      <span className="text-[#D97706] font-black">
                        累计时长: {formatAudioTime(job.totalDurationSec || 0)}
                      </span>
                    </div>

                    {job.error && (
                      <div className="p-3 bg-[#09090B] text-[#FFFFFF] font-mono text-xs font-bold">
                        <span className="text-[#D97706]">ERROR // </span>
                        {job.error}
                      </div>
                    )}

                    {(job.outputMp3Path || job.outputWavPath) && (
                      <div className="p-3.5 bg-[#D97706]/14 border-2 border-[#09090B] font-mono text-xs font-bold text-[#09090B] space-y-1">
                        {job.outputMp3Path && <div>★ 合并 MP3: {job.outputMp3Path}</div>}
                        {job.outputWavPath && <div>★ 合并 WAV: {job.outputWavPath}</div>}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </main>
      )}

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
