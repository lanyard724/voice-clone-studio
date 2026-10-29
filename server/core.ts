import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import * as tls from 'tls';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DATA_DIR = path.resolve(__dirname, '../data');
export const DB_PATH = path.join(DATA_DIR, 'studio_db.json');
export const BATCH_DIR = path.join(DATA_DIR, 'batches');
export const AUDIO_OUT_DIR = path.join(DATA_DIR, 'outputs');

export interface BatchChunkItem {
  index: number;
  text: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  file?: string;
  duration?: number;
  error?: string;
  retries: number;
}

export interface BatchJobSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  voiceId: string;
  stylePrompt: string;
  model: 'gemini-3.8-flash-tts' | 'gemini-3.8-flash-lite-tts';
  chunkSize: number;
  concurrency: number;
  pauseMs: number;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed';
  totalChars: number;
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  totalDurationSec: number;
  outputWavPath?: string;
  outputMp3Path?: string;
  error?: string;
}

export interface BatchJobManifest extends BatchJobSummary {
  chunks: BatchChunkItem[];
}

export interface StudioDbSchema {
  settings: {
    apiKey: string;
    proxyUrl: string;
    autoPlay: boolean;
    defaultModel: 'gemini-3.8-flash-tts' | 'gemini-3.8-flash-lite-tts';
    llmModel: 'gemini-4-argon' | 'gemini-3.8-flash';
  };
  voices: any[];
  history: any[];
  batchJobs: BatchJobSummary[];
}

export const CORE_DEFAULT_SETTINGS: StudioDbSchema['settings'] = {
  apiKey: process.env.GEMINI_API_KEY || '',
  proxyUrl: 'http://127.0.0.1:7900',
  autoPlay: true,
  defaultModel: 'gemini-3.8-flash-tts',
  llmModel: 'gemini-4-argon'
};

export const CORE_PRESET_VOICES = [
  { id: 'kore', name: 'voices/kore', displayName: 'Kore（沉稳端庄）', type: 'preset' },
  { id: 'zephyr', name: 'voices/zephyr', displayName: 'Zephyr（明亮欢快）', type: 'preset' },
  { id: 'puck', name: 'voices/puck', displayName: 'Puck（幽默随和）', type: 'preset' },
  { id: 'fenrir', name: 'voices/fenrir', displayName: 'Fenrir（激昂有力）', type: 'preset' },
  { id: 'charon', name: 'voices/charon', displayName: 'Charon（深邃博学）', type: 'preset' },
  { id: 'leda', name: 'voices/leda', displayName: 'Leda（青春温婉）', type: 'preset' }
];

export function ensureStudioDirs(): void {
  for (const d of [DATA_DIR, BATCH_DIR, AUDIO_OUT_DIR]) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  }
}

/**
 * Single shared 44-byte RIFF WAV header builder (24kHz 16-bit mono PCM)
 */
export function buildWavHeader(dataByteLength: number, sampleRate = 24000, numChannels = 1, bitDepth = 16): Buffer {
  const header = Buffer.alloc(44);
  const blockAlign = numChannels * (bitDepth / 8);
  const byteRate = sampleRate * blockAlign;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataByteLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataByteLength, 40);
  return header;
}

export function ensureWavBuffer(rawBuf: Buffer, sampleRate = 24000): Buffer {
  if (rawBuf.length >= 44 && rawBuf.toString('ascii', 0, 4) === 'RIFF' && rawBuf.toString('ascii', 8, 12) === 'WAVE') {
    return rawBuf;
  }
  return Buffer.concat([buildWavHeader(rawBuf.length, sampleRate), rawBuf]);
}

/**
 * Offloads inline base64 audio from history records to data/outputs/<id>.wav
 * so studio_db.json and localStorage remain lightweight (< 50KB).
 */
export function offloadHistoryRecords(records: any[]): any[] {
  ensureStudioDirs();
  return records.slice(0, 100).map((item) => {
    if (!item || typeof item !== 'object') return item;
    const recId = String(item.id || `rec_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const wavFile = path.join(AUDIO_OUT_DIR, `${recId}.wav`);
    const audioUrl = `/api/audio?id=${encodeURIComponent(recId)}`;

    if (item.audioBase64 && typeof item.audioBase64 === 'string' && item.audioBase64.length > 128) {
      try {
        const buf = ensureWavBuffer(Buffer.from(item.audioBase64, 'base64'));
        fs.writeFileSync(wavFile, buf);
      } catch (err) {
        console.warn('[StudioCore] Failed to offload history audio:', err);
      }
    }

    const hasFile = fs.existsSync(wavFile);
    return {
      ...item,
      id: recId,
      audioBase64: '',
      audioUrl: hasFile ? audioUrl : item.audioUrl || ''
    };
  });
}

export function getHistoryAudioBuffer(id: string): Buffer | null {
  const safeId = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!safeId) return null;
  const wavFile = path.join(AUDIO_OUT_DIR, `${safeId}.wav`);
  if (!fs.existsSync(wavFile)) return null;
  try {
    return fs.readFileSync(wavFile);
  } catch {
    return null;
  }
}

let lastValidDbCache: StudioDbSchema | null = null;

export function readStudioDb(): StudioDbSchema {
  ensureStudioDirs();
  const defaults: StudioDbSchema = {
    settings: { ...CORE_DEFAULT_SETTINGS },
    voices: [],
    history: [],
    batchJobs: []
  };

  if (!fs.existsSync(DB_PATH)) {
    writeStudioDb(defaults);
    return defaults;
  }

  try {
    const rawStr = fs.readFileSync(DB_PATH, 'utf-8');
    const raw = JSON.parse(rawStr);
    const hasInlineAudio = Array.isArray(raw.history) && raw.history.some((r: any) => r?.audioBase64?.length > 128);
    const hasHeavyBatchChunks = Array.isArray(raw.batchJobs) && raw.batchJobs.some((b: any) => Array.isArray(b?.chunks));

    const parsed: StudioDbSchema = {
      settings: { ...defaults.settings, ...(raw.settings || {}) },
      voices: Array.isArray(raw.voices) ? raw.voices : [],
      history: Array.isArray(raw.history) ? offloadHistoryRecords(raw.history) : [],
      batchJobs: Array.isArray(raw.batchJobs)
        ? raw.batchJobs.map((b: any) => {
            const { chunks: _omitted, ...summary } = b || {};
            return summary as BatchJobSummary;
          })
        : []
    };

    lastValidDbCache = parsed;
    if (hasInlineAudio || hasHeavyBatchChunks) {
      writeStudioDb(parsed);
    }
    return parsed;
  } catch (err) {
    console.error('[StudioCore] Failed to parse studio_db.json, preserving backup & returning cached state:', err);
    if (lastValidDbCache) {
      return lastValidDbCache;
    }
    try {
      const backupPath = `${DB_PATH}.corrupt.${Date.now()}`;
      fs.copyFileSync(DB_PATH, backupPath);
    } catch {}
    return defaults;
  }
}

/**
 * Atomic file write via temporary file + rename to prevent concurrent read corruption
 */
export function writeStudioDb(db: StudioDbSchema): void {
  ensureStudioDirs();
  const sanitized: StudioDbSchema = {
    settings: { ...CORE_DEFAULT_SETTINGS, ...(db.settings || {}) },
    voices: Array.isArray(db.voices) ? db.voices : [],
    history: offloadHistoryRecords(Array.isArray(db.history) ? db.history : []),
    batchJobs: Array.isArray(db.batchJobs)
      ? db.batchJobs.map((b: any) => {
          const { chunks: _omitted, ...summary } = b || {};
          return summary as BatchJobSummary;
        })
      : []
  };

  lastValidDbCache = sanitized;
  const payload = JSON.stringify(sanitized, null, 2);
  const tmpPath = `${DB_PATH}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, payload, 'utf-8');
    fs.renameSync(tmpPath, DB_PATH);
  } catch {
    // Fallback for Windows file lock contention
    try {
      fs.writeFileSync(DB_PATH, payload, 'utf-8');
    } finally {
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {}
      }
    }
  }
}

/**
 * Unified HTTP CONNECT Proxy-Penetrating Fetcher
 */
export async function proxyFetchRaw(options: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  proxyUrl?: string;
  timeoutMs?: number;
}): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: string }> {
  const targetUrl = new URL(options.url);
  const method = options.method || 'GET';
  const reqHeaders: Record<string, string> = { ...(options.headers || {}) };
  if (options.body && !reqHeaders['Content-Length'] && !reqHeaders['content-length']) {
    reqHeaders['Content-Length'] = String(Buffer.byteLength(options.body, 'utf-8'));
  }

  const proxyStr = options.proxyUrl ?? readStudioDb().settings.proxyUrl ?? 'http://127.0.0.1:7900';
  const timeoutMs = options.timeoutMs || 120000;

  if (proxyStr && targetUrl.protocol === 'https:') {
    try {
      const proxy = new URL(proxyStr);
      return await new Promise((resolve, reject) => {
        const connectReq = http.request({
          host: proxy.hostname,
          port: Number(proxy.port) || 7900,
          method: 'CONNECT',
          path: `${targetUrl.hostname}:${targetUrl.port || 443}`,
          timeout: 15000
        });

        connectReq.on('connect', (res, socket) => {
          if (res.statusCode !== 200) {
            socket.destroy();
            reject(new Error(`Proxy CONNECT failed with HTTP ${res.statusCode}`));
            return;
          }

          const tlsSocket = tls.connect({
            socket,
            servername: targetUrl.hostname,
            ALPNProtocols: ['http/1.1']
          });

          const req = https.request(
            {
              hostname: targetUrl.hostname,
              port: targetUrl.port || 443,
              path: targetUrl.pathname + targetUrl.search,
              method,
              headers: reqHeaders,
              createConnection: () => tlsSocket,
              timeout: timeoutMs
            },
            (resp) => {
              const chunks: Buffer[] = [];
              resp.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
              resp.on('end', () => {
                const bodyText = Buffer.concat(chunks).toString('utf-8');
                const outHeaders: Record<string, string> = {};
                for (const [k, v] of Object.entries(resp.headers)) {
                  if (v !== undefined) outHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v);
                }
                resolve({
                  status: resp.statusCode || 500,
                  statusText: resp.statusMessage || '',
                  headers: outHeaders,
                  body: bodyText
                });
              });
            }
          );

          req.on('error', reject);
          req.on('timeout', () => {
            req.destroy();
            reject(new Error('Upstream HTTPS request timed out'));
          });

          if (options.body) req.write(options.body);
          req.end();
        });

        connectReq.on('error', reject);
        connectReq.on('timeout', () => {
          connectReq.destroy();
          reject(new Error('Proxy CONNECT timed out'));
        });
        connectReq.end();
      });
    } catch (proxyErr) {
      console.warn('[StudioCore] Proxy tunnel failed, trying native fetch:', (proxyErr as Error).message);
    }
  }

  const res = await fetch(options.url, {
    method,
    headers: options.headers,
    body: options.body || undefined
  });
  const text = await res.text();
  const outHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    outHeaders[k] = v;
  });
  return {
    status: res.status,
    statusText: res.statusText,
    headers: outHeaders,
    body: text
  };
}

export function extractVoiceIdFromData(data: any): string {
  if (!data) return '';
  const item = Array.isArray(data) ? data[0] : data;
  if (!item || typeof item !== 'object') return '';
  const v = item.voice || item.replicated_voice || item.replicatedVoice || item;
  const candidate = v.voice_id || v.voiceId || v.voice_key || v.voiceKey || v.key || v.id || '';
  if (candidate) return String(candidate);
  if (typeof v.name === 'string' && v.name.includes('voices/')) {
    return v.name.split('voices/').pop() || '';
  }
  return '';
}

export function extractAudioFromResponseData(data: any): string {
  if (!data) return '';
  const list = Array.isArray(data) ? data : [data];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    if (item.output_audio?.data) return item.output_audio.data;
    if (Array.isArray(item.steps)) {
      for (const step of item.steps) {
        if (Array.isArray(step.content)) {
          for (const c of step.content) {
            if ((c.type === 'audio' || c.mime_type?.startsWith('audio/')) && c.data) return c.data;
          }
        }
      }
    }
    if (Array.isArray(item.content)) {
      for (const c of item.content) {
        if ((c.type === 'audio' || c.mime_type?.startsWith('audio/')) && c.data) return c.data;
      }
    }
    if (Array.isArray(item.candidates)) {
      for (const cand of item.candidates) {
        const parts = cand?.content?.parts;
        if (Array.isArray(parts)) {
          for (const p of parts) {
            if (p.inlineData?.data) return p.inlineData.data;
          }
        }
      }
    }
  }
  return '';
}

/**
 * Unified TTS Synthesis (Interactions API primary + generateContent fallback + RIFF WAV enforcement)
 */
export async function backendSynthesizeChunk(params: {
  apiKey: string;
  proxyUrl?: string;
  text: string;
  voiceId: string;
  stylePrompt?: string;
  model?: string;
}): Promise<{ wavBuffer: Buffer; durationSec: number }> {
  const model = params.model || 'gemini-3.8-flash-tts';
  const voiceTarget = params.voiceId.startsWith('voices/')
    ? params.voiceId.replace('voices/', '')
    : params.voiceId;
  const isCustomVoice = voiceTarget.startsWith('voice_') || voiceTarget.startsWith('voicekey_');

  const interactionBody = {
    model,
    input: [
      {
        type: 'user_input',
        content: [
          {
            type: 'text',
            text: params.text,
            ...(params.stylePrompt
              ? {
                  annotations: [{ type: 'speech_metadata', style: params.stylePrompt }]
                }
              : {})
          }
        ]
      }
    ],
    response_format: { type: 'audio', mime_type: 'audio/wav' },
    generation_config: { speech_config: [{ voice: voiceTarget }] }
  };

  const res = await proxyFetchRaw({
    url: `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(params.apiKey)}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': params.apiKey.trim()
    },
    body: JSON.stringify(interactionBody),
    proxyUrl: params.proxyUrl
  });

  let audioBase64 = '';
  if (res.status >= 200 && res.status < 300) {
    try {
      audioBase64 = extractAudioFromResponseData(JSON.parse(res.body));
    } catch {}
  } else if (isCustomVoice) {
    throw new Error(`HTTP ${res.status}: ${res.body.slice(0, 300)}`);
  }

  if (!audioBase64 && !isCustomVoice) {
    const generateBody: Record<string, any> = {
      contents: [{ parts: [{ text: params.text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voiceTarget }
          }
        }
      },
      ...(params.stylePrompt
        ? {
            systemInstruction: {
              parts: [{ text: `Speech delivery style: ${params.stylePrompt}` }]
            }
          }
        : {})
    };

    const genRes = await proxyFetchRaw({
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(params.apiKey)}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': params.apiKey.trim()
      },
      body: JSON.stringify(generateBody),
      proxyUrl: params.proxyUrl
    });

    if (genRes.status < 200 || genRes.status >= 300) {
      throw new Error(`HTTP ${genRes.status}: ${genRes.body.slice(0, 300)}`);
    }
    const genData = JSON.parse(genRes.body);
    audioBase64 = extractAudioFromResponseData(genData);
  }

  if (!audioBase64) {
    throw new Error('未从 Google API 响应中解析到音频数据');
  }

  const wavBuffer = ensureWavBuffer(Buffer.from(audioBase64, 'base64'));
  const pcmBytes = Math.max(0, wavBuffer.length - 44);
  const durationSec = Number((pcmBytes / 48000).toFixed(2));
  return { wavBuffer, durationSec };
}

/**
 * Sync custom replicated voices from Google Cloud while preserving local user metadata
 */
export async function backendSyncVoices(apiKey: string, proxyUrl?: string): Promise<any[]> {
  const res = await proxyFetchRaw({
    url: `https://generativelanguage.googleapis.com/v1beta/voices?key=${encodeURIComponent(apiKey)}`,
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey.trim()
    },
    proxyUrl
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`同步云端声线失败 HTTP ${res.status}: ${res.body.slice(0, 300)}`);
  }

  const data = JSON.parse(res.body);
  const rawList = Array.isArray(data)
    ? Array.isArray(data[0]?.voices)
      ? data[0].voices
      : data
    : Array.isArray(data.voices)
    ? data.voices
    : [];

  const db = readStudioDb();
  const existingMap = new Map(
    db.voices
      .filter((v) => v && v.id && !/^voice_\d{10,}$/.test(v.id))
      .map((v) => [v.id, v])
  );

  for (const v of rawList) {
    const item = v.voice || v;
    if (item.type === 'prebuilt') continue;
    const id = extractVoiceIdFromData(item);
    if (!id) continue;
    if (!item.type && !id.startsWith('voice_') && !id.startsWith('voicekey_')) continue;

    const existing = existingMap.get(id);
    const remoteDisplayName = item.display_name || item.displayName || item.name || id;
    existingMap.set(id, {
      id,
      name: item.name || `voices/${id}`,
      displayName: existing?.displayName || remoteDisplayName,
      originalName: remoteDisplayName,
      type: 'replicated',
      createTime: item.create_time || item.createTime || item.expire_time || existing?.createTime || new Date().toISOString(),
      sampleAudioUrl: existing?.sampleAudioUrl,
      isFavorite: existing?.isFavorite || false,
      tags: existing?.tags || ['云端同步', '克隆声线']
    });
  }

  const merged = Array.from(existingMap.values());
  db.voices = merged;
  writeStudioDb(db);
  return merged;
}

/**
 * Convert any local audio file to 24kHz 16-bit mono WAV Base64 via ffmpeg
 */
export async function convertAudioFileTo24kMonoWavBase64(filePath: string): Promise<string> {
  ensureStudioDirs();
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`找不到音频文件: ${absPath}`);
  }
  const tmpWav = path.join(DATA_DIR, `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.wav`);
  await new Promise<void>((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y',
      '-i',
      absPath,
      '-ar',
      '24000',
      '-ac',
      '1',
      '-sample_fmt',
      's16',
      '-f',
      'wav',
      tmpWav
    ]);
    ff.on('close', (code) => {
      if (code === 0 && fs.existsSync(tmpWav)) resolve();
      else reject(new Error(`ffmpeg 转码失败 (exit ${code})`));
    });
    ff.on('error', reject);
  });
  const buf = fs.readFileSync(tmpWav);
  try {
    fs.unlinkSync(tmpWav);
  } catch {}
  return buf.toString('base64');
}

/**
 * Unified Voice Cloning matching exact Google REST /v1beta/voices schema
 */
export async function backendCloneVoice(params: {
  apiKey: string;
  proxyUrl?: string;
  displayName: string;
  sourceAudioBase64: string;
  consentAudioBase64: string;
  tags?: string[];
}): Promise<any> {
  const body = {
    store: true,
    voice: {
      model: 'gemini-3.8-flash-tts',
      type: 'replicated',
      display_name: params.displayName.trim(),
      replicated: {
        source_audio: {
          data: params.sourceAudioBase64,
          mime_type: 'audio/wav'
        },
        consent_audio: {
          data: params.consentAudioBase64,
          mime_type: 'audio/wav'
        }
      }
    }
  };

  const res = await proxyFetchRaw({
    url: `https://generativelanguage.googleapis.com/v1beta/voices?key=${encodeURIComponent(params.apiKey)}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': params.apiKey.trim()
    },
    body: JSON.stringify(body),
    proxyUrl: params.proxyUrl
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`声线克隆失败 HTTP ${res.status}: ${res.body.slice(0, 300)}`);
  }

  const data = JSON.parse(res.body);
  const id = extractVoiceIdFromData(data);
  if (!id) {
    throw new Error(`未能从响应中提取真实 voice_id: ${res.body.slice(0, 200)}`);
  }

  const newVoice = {
    id,
    name: data.name || data.voice?.name || `voices/${id}`,
    displayName: params.displayName.trim(),
    type: 'replicated',
    createTime: data.create_time || data.voice?.create_time || new Date().toISOString(),
    tags: params.tags || ['CLI克隆', '专属声纹']
  };

  const db = readStudioDb();
  db.voices = [newVoice, ...db.voices.filter((x) => x.id !== id)];
  writeStudioDb(db);
  return newVoice;
}

/**
 * Unified LLM Director Mode (Defaults to Gemini 4 Argon: gemini-4-argon)
 */
export async function backendDirectScript(params: {
  apiKey: string;
  proxyUrl?: string;
  rawText: string;
  targetLanguage?: string;
  moodStyle?: string;
  llmModel?: string;
}): Promise<{ enhanced_text: string; target_language: string; speech_style: string; director_notes: string; model: string }> {
  const targetLanguage = params.targetLanguage || 'zh-CN';
  const moodStyle = params.moodStyle || '自然生动';
  const modelToUse = (params.llmModel || readStudioDb().settings.llmModel || 'gemini-4-argon').trim();
  const systemPrompt = `你是一位好莱坞录音棚级语音配音导演。将原始草稿润色为富有表现力的有声台词。
目标语言：${targetLanguage}
情感氛围风格：${moodStyle}
适度插入 Gemini 3.8 Flash TTS 原生标记：[laugh]、[sigh]、[gasp]、[cough]、[throat-clearing]、[short pause]、[medium pause]、[whispering]。
输出严格 JSON：{"enhanced_text":"...","target_language":"...","speech_style":"...","director_notes":"..."}`;

  const res = await proxyFetchRaw({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelToUse)}:generateContent?key=${encodeURIComponent(params.apiKey)}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n【原始台词】：\n${params.rawText}` }] }],
      generationConfig: { temperature: 0.7, responseMimeType: 'application/json' }
    }),
    proxyUrl: params.proxyUrl
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`导演润色失败 (${modelToUse}) HTTP ${res.status}: ${res.body.slice(0, 300)}`);
  }

  const data = JSON.parse(res.body);
  const parts: any[] = data?.candidates?.[0]?.content?.parts || [];
  const answerPart = [...parts].reverse().find((p) => p && typeof p.text === 'string' && !p.thought) || parts[0];
  const rawContent = String(answerPart?.text || '{}')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const parsed = JSON.parse(rawContent);
  return {
    enhanced_text: parsed.enhanced_text || params.rawText,
    target_language: parsed.target_language || targetLanguage,
    speech_style: parsed.speech_style || moodStyle,
    director_notes: parsed.director_notes || `由 ${modelToUse} 扩写生成`,
    model: modelToUse
  };
}

/**
 * Smart text splitter for long-form synthesis (respects chapters, paragraphs, and sentences)
 */
export function splitTextIntoChunks(rawText: string, maxChars = 1000): string[] {
  const cleaned = rawText.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxChars) return [cleaned];

  const paragraphs = cleaned.split(/\n+/);
  const chunks: string[] = [];
  let current = '';

  const pushCurrent = () => {
    if (current.trim()) {
      chunks.push(current.trim());
      current = '';
    }
  };

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    const isChapterHeader = /^(第[零一二三四五六七八九十百千万0-9]+[章节回集部篇]|Chapter\s+\d+|CHAPTER\s+\d+)/i.test(trimmed);
    if (isChapterHeader && current.trim().length > 0) {
      pushCurrent();
    }

    if ((current + '\n' + trimmed).trim().length <= maxChars) {
      current = current ? `${current}\n${trimmed}` : trimmed;
    } else if (trimmed.length <= maxChars) {
      pushCurrent();
      current = trimmed;
    } else {
      const sentences = trimmed.match(/[^。！？；.!?;]+[。！？；.!?;”]*/g) || [trimmed];
      for (const sent of sentences) {
        if ((current + sent).length <= maxChars) {
          current += sent;
        } else {
          pushCurrent();
          if (sent.length <= maxChars) {
            current = sent;
          } else {
            for (let i = 0; i < sent.length; i += maxChars) {
              chunks.push(sent.slice(i, i + maxChars));
            }
          }
        }
      }
    }
  }
  pushCurrent();
  return chunks;
}

/**
 * Stitch completed WAV chunks seamlessly using FFmpeg with strict exit code & output verification
 */
export async function stitchBatchAudio(
  jobDir: string,
  manifest: BatchJobManifest
): Promise<{ wavPath?: string; mp3Path?: string; error?: string }> {
  const chunksDir = path.join(jobDir, 'chunks');
  const silencePath = path.join(jobDir, 'silence.wav');

  const pauseSamples = Math.floor((manifest.pauseMs / 1000) * 24000);
  const pauseBytes = pauseSamples * 2;
  fs.writeFileSync(silencePath, Buffer.concat([buildWavHeader(pauseBytes, 24000, 1, 16), Buffer.alloc(pauseBytes)]));

  const listFile = path.join(jobDir, 'concat_list.txt');
  const lines: string[] = [];
  const validChunks = manifest.chunks.filter((c) => c.status === 'completed' && c.file);

  validChunks.forEach((c, idx) => {
    const chunkFull = path.join(chunksDir, c.file!).replace(/\\/g, '/');
    lines.push(`file '${chunkFull}'`);
    if (idx < validChunks.length - 1 && pauseBytes > 0) {
      lines.push(`file '${silencePath.replace(/\\/g, '/')}'`);
    }
  });
  fs.writeFileSync(listFile, lines.join('\n'), 'utf-8');

  const safeTitle = manifest.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || manifest.id;
  const mp3Path = path.join(jobDir, `${safeTitle}_merged.mp3`);
  const wavPath = path.join(jobDir, `${safeTitle}_merged.wav`);

  const runFfmpeg = (args: string[]): Promise<{ ok: boolean; stderr: string }> =>
    new Promise((resolve) => {
      const stderrChunks: Buffer[] = [];
      const ff = spawn('ffmpeg', args);
      ff.stderr.on('data', (d) => stderrChunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
      ff.on('close', (code) => {
        resolve({
          ok: code === 0,
          stderr: Buffer.concat(stderrChunks).toString('utf-8').slice(-400)
        });
      });
      ff.on('error', (err) => {
        resolve({ ok: false, stderr: err.message });
      });
    });

  const mp3Res = await runFfmpeg([
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listFile,
    '-c:a',
    'libmp3lame',
    '-b:a',
    '96k',
    '-ar',
    '24000',
    '-ac',
    '1',
    mp3Path
  ]);

  let wavRes = { ok: false, stderr: '' };
  if (manifest.totalDurationSec < 20 * 3600) {
    wavRes = await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'copy', wavPath]);
  }

  const hasMp3 = mp3Res.ok && fs.existsSync(mp3Path) && fs.statSync(mp3Path).size > 0;
  const hasWav = wavRes.ok && fs.existsSync(wavPath) && fs.statSync(wavPath).size > 0;

  if (!hasMp3 && !hasWav) {
    return {
      error: `FFmpeg 音频合并失败: ${mp3Res.stderr || wavRes.stderr || '未生成有效输出文件'}`
    };
  }

  return {
    wavPath: hasWav ? wavPath : undefined,
    mp3Path: hasMp3 ? mp3Path : undefined
  };
}
