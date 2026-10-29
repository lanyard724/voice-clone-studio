#!/usr/bin/env node
/**
 * Voice Clone Studio - Unified CLI & Non-CDP Web UI Controller
 * Directly reuses server/core.ts to eliminate code duplication and schema drift.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  AUDIO_OUT_DIR,
  CORE_PRESET_VOICES,
  readStudioDb,
  writeStudioDb,
  proxyFetchRaw,
  backendSynthesizeChunk,
  backendSyncVoices,
  convertAudioFileTo24kMonoWavBase64,
  backendCloneVoice,
  backendDirectScript
} from './server/core.ts';

const __filename = fileURLToPath(import.meta.url);
const SERVER_BASE = process.env.VOICE_STUDIO_URL || 'http://localhost:5174';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const eqIdx = token.indexOf('=');
      if (eqIdx > 2) {
        const key = token.slice(2, eqIdx);
        const val = token.slice(eqIdx + 1);
        args[key] = val;
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          args[key] = next;
          i++;
        } else {
          args[key] = true;
        }
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

async function callBridgeApi(endpoint, method = 'GET', body = undefined) {
  try {
    const res = await fetch(`${SERVER_BASE}${endpoint}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Commit state changes through the running Vite server when available (single writer),
 * or fallback to atomic local DB write when running headlessly.
 */
async function commitStateUpdate(partial) {
  const remoteRes = await callBridgeApi('/api/state', 'POST', { ...partial, broadcast: true });
  if (remoteRes?.ok) return remoteRes.state;
  const db = readStudioDb();
  if (partial.settings) db.settings = { ...db.settings, ...partial.settings };
  if (Array.isArray(partial.voices)) db.voices = partial.voices;
  if (Array.isArray(partial.history)) db.history = partial.history;
  writeStudioDb(db);
  return db;
}

export async function runCli(rawArgv = process.argv.slice(2)) {
  const args = parseArgs(rawArgv);
  const cmd = args._[0] || 'status';

  // 1. STATUS
  if (cmd === 'status') {
    const bridgeStatus = await callBridgeApi('/api/status');
    const db = readStudioDb();
    const out = {
      ok: true,
      serverRunning: Boolean(bridgeStatus),
      serverUrl: SERVER_BASE,
      connectedBrowserTabs: bridgeStatus?.connectedBrowserClients || 0,
      liveUiState: bridgeStatus?.uiState || { connected: false },
      settings: {
        apiKeyConfigured: Boolean(db.settings.apiKey),
        apiKeyMasked: db.settings.apiKey
          ? `${db.settings.apiKey.slice(0, 6)}...${db.settings.apiKey.slice(-4)}`
          : '(未设置)',
        proxyUrl: db.settings.proxyUrl,
        defaultModel: db.settings.defaultModel,
        llmModel: db.settings.llmModel || 'gemini-4-argon'
      },
      customVoicesCount: db.voices.length,
      presetVoicesCount: CORE_PRESET_VOICES.length,
      historyCount: db.history.length,
      batchJobsCount: db.batchJobs.length
    };
    console.log(JSON.stringify(out, null, 2));
    return out;
  }

  // 2. UI REMOTE CONTROL (Zero-CDP)
  if (cmd === 'ui') {
    const payload = {};
    if (args.tab) payload.activeTab = args.tab;
    if (args.mode) payload.synthesisMode = args.mode;
    if (args.voice) payload.selectedVoiceId = args.voice;
    if (args.text !== undefined) payload.inputText = String(args.text);
    if (args['text-file']) {
      payload.inputText = fs.readFileSync(path.resolve(args['text-file']), 'utf-8');
    }
    if (args.style !== undefined) payload.stylePrompt = String(args.style);
    if (args.preset !== undefined) payload.selectedStylePreset = String(args.preset);
    if (args.draft !== undefined) payload.directorDraft = String(args.draft);
    if (args.lang) payload.targetLang = args.lang;
    if (args.mood !== undefined) payload.directorMood = String(args.mood);
    if (args.filter) payload.repoFilter = args.filter;
    if (args.search !== undefined) payload.repoSearch = String(args.search);
    if (args['llm-model']) payload.llmModel = String(args['llm-model']);
    if (args['open-clone'] !== undefined) payload.isCloneModalOpen = Boolean(args['open-clone']);
    if (args['open-settings'] !== undefined) payload.isSettingsModalOpen = Boolean(args['open-settings']);

    const results = [];
    if (Object.keys(payload).length > 0) {
      const setRes = await callBridgeApi('/api/control', 'POST', {
        action: 'set-ui',
        payload,
        waitMs: 5000
      });
      results.push({ step: 'set-ui', response: setRes });
    }

    if (args.trigger) {
      const triggerMap = {
        synthesize: 'trigger-synthesize',
        synth: 'trigger-synthesize',
        director: 'trigger-director',
        direct: 'trigger-director',
        'sync-voices': 'sync-voices',
        sync: 'sync-voices'
      };
      const actionName = triggerMap[args.trigger] || args.trigger;
      const trigRes = await callBridgeApi('/api/control', 'POST', {
        action: actionName,
        payload,
        waitMs: 90000
      });
      results.push({ step: actionName, response: trigRes });
    }

    const out = { ok: true, results };
    console.log(JSON.stringify(out, null, 2));
    return out;
  }

  // 3. CONFIG
  if (cmd === 'config') {
    const db = readStudioDb();
    const nextSettings = { ...db.settings };
    let changed = false;

    if (args['api-key'] !== undefined) {
      nextSettings.apiKey = String(args['api-key'] === true ? '' : args['api-key']).trim();
      changed = true;
    }
    if (args.proxy !== undefined) {
      nextSettings.proxyUrl = String(args.proxy).trim();
      changed = true;
    }
    if (args.model !== undefined) {
      nextSettings.defaultModel = String(args.model).trim();
      changed = true;
    }
    if (args['llm-model'] !== undefined) {
      nextSettings.llmModel = String(args['llm-model']).trim();
      changed = true;
    }
    if (changed) {
      await commitStateUpdate({ settings: nextSettings });
    }

    let connectivity = null;
    if (args.test) {
      if (!nextSettings.apiKey) {
        connectivity = { ok: false, message: '未配置 API Key' };
      } else {
        const start = Date.now();
        const res = await proxyFetchRaw({
          url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(nextSettings.apiKey)}`,
          proxyUrl: nextSettings.proxyUrl
        });
        const latencyMs = Date.now() - start;
        connectivity = {
          ok: res.status === 200,
          status: res.status,
          latencyMs,
          message: res.status === 200 ? `连通正常 (${latencyMs}ms)` : res.body.slice(0, 200)
        };
      }
    }

    const out = {
      ok: true,
      settings: {
        ...nextSettings,
        apiKeyMasked: nextSettings.apiKey
          ? `${nextSettings.apiKey.slice(0, 6)}...${nextSettings.apiKey.slice(-4)}`
          : '(未设置)'
      },
      connectivity
    };
    console.log(JSON.stringify(out, null, 2));
    return out;
  }

  // 4. VOICES
  if (cmd === 'voices') {
    const sub = args._[1] || 'list';
    const db = readStudioDb();

    if (sub === 'list') {
      const out = {
        ok: true,
        voices: [...CORE_PRESET_VOICES, ...db.voices]
      };
      console.log(JSON.stringify(out, null, 2));
      return out;
    }

    if (sub === 'sync') {
      if (!db.settings.apiKey) throw new Error('请先配置 API Key: node cli.mjs config --api-key <KEY>');
      const mergedVoices = await backendSyncVoices(db.settings.apiKey, db.settings.proxyUrl);
      await commitStateUpdate({ voices: mergedVoices });
      const out = { ok: true, syncedCount: mergedVoices.length, voices: mergedVoices };
      console.log(JSON.stringify(out, null, 2));
      return out;
    }

    if (sub === 'delete') {
      const targetId = args._[2] || args.id;
      if (!targetId) throw new Error('请指定要删除的声线 ID');
      if (db.settings.apiKey) {
        const namePath = targetId.startsWith('voices/') ? targetId : `voices/${targetId}`;
        await proxyFetchRaw({
          url: `https://generativelanguage.googleapis.com/v1beta/${namePath}?key=${encodeURIComponent(db.settings.apiKey)}`,
          method: 'DELETE',
          proxyUrl: db.settings.proxyUrl
        });
      }
      const nextVoices = db.voices.filter((v) => v.id !== targetId);
      await commitStateUpdate({ voices: nextVoices });
      const out = { ok: true, deleted: targetId };
      console.log(JSON.stringify(out, null, 2));
      return out;
    }
  }

  // 5. CLONE VOICE (Aligned with Google REST /v1beta/voices schema)
  if (cmd === 'clone') {
    const db = readStudioDb();
    if (!db.settings.apiKey) throw new Error('请先配置 API Key');
    const displayName = args.name || `克隆声线_${Date.now()}`;
    const sourcePath = args.source;
    const consentPath = args.consent;
    if (!sourcePath || !consentPath) {
      throw new Error('需要同时提供 --source <参考音频路径> 与 --consent <授权朗读音频路径>');
    }

    const [sourceAudioBase64, consentAudioBase64] = await Promise.all([
      convertAudioFileTo24kMonoWavBase64(sourcePath),
      convertAudioFileTo24kMonoWavBase64(consentPath)
    ]);

    const newVoice = await backendCloneVoice({
      apiKey: db.settings.apiKey,
      proxyUrl: db.settings.proxyUrl,
      displayName,
      sourceAudioBase64,
      consentAudioBase64,
      tags: args.tags ? String(args.tags).split(',') : ['CLI克隆', '专属声纹']
    });

    const updatedDb = readStudioDb();
    await commitStateUpdate({ voices: updatedDb.voices });
    const out = { ok: true, voice: newVoice };
    console.log(JSON.stringify(out, null, 2));
    return out;
  }

  // 6. DIRECTOR MODE (Gemini 4 Argon by default)
  if (cmd === 'direct') {
    const db = readStudioDb();
    if (!db.settings.apiKey) throw new Error('请先配置 API Key');
    const rawText = args.file
      ? fs.readFileSync(path.resolve(args.file), 'utf-8')
      : String(args.text || args.draft || '');
    if (!rawText.trim()) throw new Error('请提供 --text/--draft 或 --file');

    const llmModel = args['llm-model'] || args.model || db.settings.llmModel || 'gemini-4-argon';
    const parsed = await backendDirectScript({
      apiKey: db.settings.apiKey,
      proxyUrl: db.settings.proxyUrl,
      rawText,
      targetLanguage: args.lang || 'zh-CN',
      moodStyle: args.mood || '自然生动',
      llmModel
    });

    if (args['push-ui']) {
      await callBridgeApi('/api/control', 'POST', {
        action: 'set-ui',
        payload: {
          activeTab: 'studio',
          synthesisMode: 'director',
          directorDraft: rawText,
          inputText: parsed.enhanced_text || rawText,
          stylePrompt: parsed.speech_style || args.mood || '自然生动'
        }
      });
    }

    const out = { ok: true, directorResult: parsed };
    console.log(JSON.stringify(out, null, 2));
    return out;
  }

  // 7. SYNTHESIZE SPEECH
  if (cmd === 'synth' || cmd === 'synthesize') {
    const db = readStudioDb();
    if (!db.settings.apiKey) throw new Error('请先配置 API Key: node cli.mjs config --api-key <KEY>');
    const text = args.file
      ? fs.readFileSync(path.resolve(args.file), 'utf-8').trim()
      : String(args.text || '').trim();
    if (!text) throw new Error('请提供 --text "<台词>" 或 --file <文件路径>');

    const voiceId = args.voice || 'kore';
    const stylePrompt = args.style || 'calm, natural, and balanced cadence';
    const model = args.model || db.settings.defaultModel || 'gemini-3.8-flash-tts';

    const { wavBuffer, durationSec } = await backendSynthesizeChunk({
      apiKey: db.settings.apiKey,
      proxyUrl: db.settings.proxyUrl,
      text,
      voiceId,
      stylePrompt,
      model
    });

    const recId = `rec_${Date.now()}`;
    const defaultWavPath = path.join(AUDIO_OUT_DIR, `${recId}.wav`);
    fs.mkdirSync(AUDIO_OUT_DIR, { recursive: true });
    fs.writeFileSync(defaultWavPath, wavBuffer);

    const outPath = args.out ? path.resolve(args.out) : defaultWavPath;
    if (outPath !== defaultWavPath) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.copyFileSync(defaultWavPath, outPath);
    }

    const audioBase64 = wavBuffer.toString('base64');
    const allVoices = [...CORE_PRESET_VOICES, ...db.voices];
    const matchedVoice = allVoices.find((v) => v.id === voiceId);

    const record = {
      id: recId,
      timestamp: Date.now(),
      text,
      voiceId,
      voiceName: matchedVoice?.displayName || voiceId,
      stylePrompt,
      audioBase64: '',
      audioUrl: `/api/audio?id=${encodeURIComponent(recId)}`,
      audioDuration: durationSec,
      model
    };

    const nextHistory = [record, ...db.history].slice(0, 100);
    await commitStateUpdate({ history: nextHistory });

    if (args['push-ui'] !== false) {
      await callBridgeApi('/api/control', 'POST', {
        action: 'set-ui',
        payload: {
          activeTab: 'studio',
          inputText: text,
          selectedVoiceId: voiceId,
          stylePrompt,
          audioBase64
        }
      });
    }

    const out = {
      ok: true,
      outputFile: outPath,
      audioUrl: record.audioUrl,
      durationSec,
      bytes: wavBuffer.length,
      voiceId,
      model
    };
    console.log(JSON.stringify(out, null, 2));
    return out;
  }

  // 8. LONG-FORM BATCH ENGINE (10+ hours support)
  if (cmd === 'batch') {
    const sub = args._[1] || 'status';
    if (sub === 'status') {
      const jobId = args._[2] || args.id;
      const res = await callBridgeApi(jobId ? `/api/batch?id=${encodeURIComponent(jobId)}` : '/api/batch');
      const out = res || { jobs: readStudioDb().batchJobs };
      console.log(JSON.stringify(out, null, 2));
      return out;
    }

    if (sub === 'start' || sub === 'create') {
      const text = args.file
        ? fs.readFileSync(path.resolve(args.file), 'utf-8').trim()
        : String(args.text || '').trim();
      if (!text) throw new Error('请提供 --file <长文本路径> 或 --text "<内容>"');

      const res = await callBridgeApi('/api/batch', 'POST', {
        action: 'create',
        title: args.title || (args.file ? path.basename(args.file, path.extname(args.file)) : undefined),
        text,
        voiceId: args.voice || 'kore',
        stylePrompt: args.style || 'calm, natural, and balanced cadence',
        model: args.model || 'gemini-3.8-flash-tts',
        chunkSize: Number(args['chunk-size']) || 1000,
        concurrency: Number(args.concurrency) || 2
      });
      if (!res) throw new Error('无法连接本地工作台服务 http://localhost:5174');
      await callBridgeApi('/api/control', 'POST', {
        action: 'set-ui',
        payload: { activeTab: 'batch' }
      });
      console.log(JSON.stringify(res, null, 2));
      return res;
    }

    if (sub === 'pause' || sub === 'resume' || sub === 'delete') {
      const jobId = args._[2] || args.id;
      if (!jobId) throw new Error(`请提供任务 ID: node cli.mjs batch ${sub} <jobId>`);
      const res = await callBridgeApi('/api/batch', 'POST', { action: sub, jobId });
      console.log(JSON.stringify(res, null, 2));
      return res;
    }
  }

  throw new Error(`未知命令: ${cmd}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runCli().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2));
    process.exit(1);
  });
}
