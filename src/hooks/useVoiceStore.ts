import { useState, useEffect, useCallback } from 'react';
import { VoiceItem, GenerationRecord, AppSettings, CloneVoicePayload } from '../api/types';
import { storage } from '../utils/storage';
import { createReplicatedVoice, listReplicatedVoices, deleteReplicatedVoice } from '../api/gemini';

export function useVoiceStore() {
  const [voices, setVoices] = useState<VoiceItem[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('kore');
  const [history, setHistory] = useState<GenerationRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings>({
    apiKey: '',
    proxyUrl: 'http://127.0.0.1:7900',
    autoPlay: true,
    defaultModel: 'gemini-3.8-flash-tts'
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Initial load
  useEffect(() => {
    let mounted = true;
    async function init() {
      setIsLoading(true);
      try {
        const [loadedSettings, loadedVoices, loadedHistory] = await Promise.all([
          storage.getSettings(),
          storage.getVoices(),
          storage.getHistory()
        ]);
        if (!mounted) return;
        setSettings(loadedSettings);

        // Sanitize legacy dummy timestamp voices (e.g. voice_1750012541213)
        const sanitizedVoices = loadedVoices.filter(v => !/^voice_\d{10,}$/.test(v.id));
        if (sanitizedVoices.length !== loadedVoices.length) {
          storage.saveCustomVoices(sanitizedVoices);
        }

        setVoices(sanitizedVoices);
        setHistory(loadedHistory);
        if (sanitizedVoices.length > 0) {
          setSelectedVoiceId(sanitizedVoices[0].id);
        }
      } catch (err) {
        console.error('Failed to initialize voice store', err);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    init();
    return () => {
      mounted = false;
    };
  }, []);

  const updateSettings = useCallback(async (partial: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...partial };
      storage.saveSettings(next);
      return next;
    });
  }, []);

  const syncCloudVoices = useCallback(async (): Promise<{ count: number; error?: string }> => {
    if (!settings.apiKey) return { count: 0, error: '请先在设置中填写 Gemini API Key' };
    setIsSyncing(true);
    try {
      const cloudVoices = await listReplicatedVoices(settings.apiKey);
      let count = 0;
      setVoices(prev => {
        // Filter out legacy dummy timestamp voices
        const currentCustom = prev.filter(v => v.type === 'replicated' && !/^voice_\d{10,}$/.test(v.id));
        const customMap = new Map(currentCustom.map(v => [v.id, v]));

        cloudVoices.forEach(cv => {
          if (!customMap.has(cv.id)) {
            customMap.set(cv.id, cv);
          } else {
            const existing = customMap.get(cv.id)!;
            customMap.set(cv.id, {
              ...cv,
              displayName: existing.displayName || cv.displayName,
              sampleAudioUrl: existing.sampleAudioUrl || cv.sampleAudioUrl,
              isFavorite: existing.isFavorite,
              tags: existing.tags || cv.tags
            });
          }
        });

        const mergedCustom = Array.from(customMap.values());
        const presets = prev.filter(v => v.type === 'preset');
        const allVoices = [...presets, ...mergedCustom];
        storage.saveCustomVoices(allVoices);
        count = cloudVoices.length;
        return allVoices;
      });
      return { count };
    } catch (err: any) {
      console.error('Failed to sync cloud voices', err);
      return { count: 0, error: err?.message || String(err) };
    } finally {
      setIsSyncing(false);
    }
  }, [settings.apiKey]);

  const addClonedVoice = useCallback(async (payload: CloneVoicePayload, sampleDataUrl?: string) => {
    if (!settings.apiKey) throw new Error('请先在设置中填写 Gemini API Key');
    const newVoice = await createReplicatedVoice(settings.apiKey, payload);
    if (sampleDataUrl) {
      newVoice.sampleAudioUrl = sampleDataUrl;
    }
    setVoices(prev => {
      const updated = [newVoice, ...prev];
      storage.saveCustomVoices(updated);
      return updated;
    });
    setSelectedVoiceId(newVoice.id);
    return newVoice;
  }, [settings.apiKey]);

  const updateVoiceName = useCallback((voiceId: string, newName: string) => {
    setVoices(prev => {
      const updated = prev.map(v => v.id === voiceId ? { ...v, displayName: newName.trim() } : v);
      storage.saveCustomVoices(updated);
      return updated;
    });
  }, []);

  const toggleFavorite = useCallback((voiceId: string) => {
    setVoices(prev => {
      const updated = prev.map(v => v.id === voiceId ? { ...v, isFavorite: !v.isFavorite } : v);
      storage.saveCustomVoices(updated);
      return updated;
    });
  }, []);

  const removeVoice = useCallback(async (voiceId: string) => {
    const target = voices.find(v => v.id === voiceId);
    if (!target) return;

    if (target.type === 'preset') {
      throw new Error('系统内置官方预设声线不可删除');
    }

    // Call Cloud Delete
    if (settings.apiKey) {
      try {
        await deleteReplicatedVoice(settings.apiKey, voiceId);
      } catch (err) {
        console.warn('Cloud delete failed, proceeding with local deletion', err);
      }
    }

    setVoices(prev => {
      const updated = prev.filter(v => v.id !== voiceId);
      storage.saveCustomVoices(updated);
      return updated;
    });

    if (selectedVoiceId === voiceId) {
      const firstPreset = voices.find(v => v.type === 'preset');
      setSelectedVoiceId(firstPreset ? firstPreset.id : '');
    }
  }, [voices, settings.apiKey, selectedVoiceId]);

  const addHistoryRecord = useCallback((record: GenerationRecord) => {
    setHistory(prev => {
      const updated = [record, ...prev];
      storage.saveHistory(updated);
      return updated;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    storage.saveHistory([]);
  }, []);

  const deleteHistoryRecord = useCallback((recordId: string) => {
    setHistory(prev => {
      const updated = prev.filter(r => r.id !== recordId);
      storage.saveHistory(updated);
      return updated;
    });
  }, []);

  return {
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
  };
}
