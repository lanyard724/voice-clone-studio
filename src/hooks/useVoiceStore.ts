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
        setVoices(loadedVoices);
        setHistory(loadedHistory);
        if (loadedVoices.length > 0) {
          // If previous selection exists in list, keep it; else first voice
          setSelectedVoiceId(loadedVoices[0].id);
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

  const syncCloudVoices = useCallback(async () => {
    if (!settings.apiKey) return;
    setIsSyncing(true);
    try {
      const cloudVoices = await listReplicatedVoices(settings.apiKey);
      setVoices(prev => {
        // Merge cloud voices with local voices (preserving local custom nicknames & sample paths)
        const currentCustom = prev.filter(v => v.type === 'replicated');
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
        return allVoices;
      });
    } catch (err) {
      console.error('Failed to sync cloud voices', err);
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
