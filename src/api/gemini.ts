import {
  VoiceItem,
  CloneVoicePayload,
  DirectorResult,
  SynthesizePayload,
  ConnectionTestResult
} from './types';
import { base64ToBlob, ensureWavBase64 } from '../utils/audioConverter';

const API_BASE = 'https://generativelanguage.googleapis.com';

/**
 * Universal fetch wrapper that checks for IPC proxy execution if in Electron,
 * or falls back to browser fetch.
 */
async function apiFetch(endpoint: string, options: RequestInit): Promise<Response> {
  const fullUrl = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;

  if (window.electronAPI?.request) {
    try {
      const result = await window.electronAPI.request({
        url: fullUrl,
        method: options.method || 'GET',
        headers: (options.headers as Record<string, string>) || {},
        body: options.body as string | undefined
      });
      return new Response(result.body, {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers
      });
    } catch (err) {
      console.warn('IPC request failed, fallback to local bridge', err);
    }
  }

  // Try Vite / Node local proxy bridge first (penetrates 127.0.0.1:7900 in browser mode)
  try {
    const bridgeRes = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: fullUrl,
        method: options.method || 'GET',
        headers: (options.headers as Record<string, string>) || {},
        body: options.body as string | undefined
      })
    });
    if (bridgeRes.ok) {
      const result = await bridgeRes.json();
      if (typeof result?.status === 'number') {
        return new Response(result.body, {
          status: result.status,
          statusText: result.statusText || '',
          headers: result.headers || {}
        });
      }
    }
  } catch (err) {
    console.warn('Local bridge proxy unavailable, fallback to browser native fetch', err);
  }

  return await fetch(fullUrl, options);
}

/**
 * Test connectivity and API Key validity
 */
export async function testConnection(apiKey: string): Promise<ConnectionTestResult> {
  if (!apiKey.trim()) {
    return { success: false, message: '请先输入有效的 Google Gemini API Key' };
  }

  const start = performance.now();
  try {
    const res = await apiFetch(`/v1beta/models?key=${encodeURIComponent(apiKey)}`, {
      method: 'GET'
    });
    const latencyMs = Math.round(performance.now() - start);

    if (res.ok) {
      return {
        success: true,
        message: `连通正常，服务延迟 ${latencyMs}ms`,
        latencyMs
      };
    } else {
      const errJson = await res.json().catch(() => ({}));
      const errMsg = errJson?.error?.message || `HTTP ${res.status} ${res.statusText}`;
      return {
        success: false,
        message: `验证失败：${errMsg}`,
        latencyMs
      };
    }
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      success: false,
      message: `网络连接异常，请检查代理配置（默认 7900）：${err instanceof Error ? err.message : String(err)}`,
      latencyMs
    };
  }
}

export function extractVoiceId(data: any): string {
  if (!data) return '';
  const item = Array.isArray(data) ? data[0] : data;
  if (!item || typeof item !== 'object') return '';

  // 1. Direct fields
  if (item.voice_id) return item.voice_id;
  if (item.voiceId) return item.voiceId;
  if (item.voice_key) return item.voice_key;
  if (item.voiceKey) return item.voiceKey;
  if (item.key) return item.key;
  if (item.id && typeof item.id === 'string' && (item.id.startsWith('voice_') || item.id.startsWith('voicekey_'))) {
    return item.id;
  }

  // 2. Nested voice object (Google REST API standard format)
  const v = item.voice || item.replicated_voice || item.replicatedVoice;
  if (v && typeof v === 'object') {
    if (v.voice_id) return v.voice_id;
    if (v.voiceId) return v.voiceId;
    if (v.voice_key) return v.voice_key;
    if (v.voiceKey) return v.voiceKey;
    if (v.key) return v.key;
    if (v.id) return v.id;
    if (v.name && typeof v.name === 'string') {
      return v.name.replace(/^voices\//, '');
    }
  }

  // 3. Top-level name field (e.g. "voices/voice_...")
  if (item.name && typeof item.name === 'string') {
    return item.name.replace(/^voices\//, '');
  }

  return '';
}

/**
 * Voice Replication (Voice Cloning)
 * Calls POST /v1beta/voices with source_audio and consent_audio
 */
export async function createReplicatedVoice(
  apiKey: string,
  payload: CloneVoicePayload
): Promise<VoiceItem> {
  if (!apiKey) throw new Error('API Key 未配置');
  if (!payload.sourceAudioBase64) throw new Error('缺少参考音频');
  if (!payload.consentAudioBase64) throw new Error('缺少法定授权文案录音');

  const requestBody = {
    store: payload.store ?? true,
    voice: {
      model: 'gemini-3.8-flash-tts',
      type: 'replicated',
      display_name: payload.displayName.trim() || '我的克隆声线',
      replicated: {
        source_audio: {
          mime_type: 'audio/wav',
          data: payload.sourceAudioBase64
        },
        consent_audio: {
          mime_type: 'audio/wav',
          data: payload.consentAudioBase64
        }
      }
    }
  };

  const res = await apiFetch(`/v1beta/voices?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey.trim()
    },
    body: JSON.stringify(requestBody)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let errJson: any = null;
    try {
      errJson = JSON.parse(errText);
    } catch {}

    const rawMsg = errJson?.error?.message || errText || `HTTP ${res.status}`;
    let detailMsg = '';
    if (Array.isArray(errJson?.error?.details)) {
      for (const d of errJson.error.details) {
        if (d.metadata?.original_error) {
          detailMsg += ` [${d.metadata.original_error}]`;
        } else if (d.message) {
          detailMsg += ` [${d.message}]`;
        }
      }
    }

    if (
      rawMsg.includes('Error translating server response to JSON') ||
      detailMsg.includes('Consent flow failed') ||
      rawMsg.includes('Consent flow failed')
    ) {
      throw new Error(
        'Google 官方声纹授权校验失败（Consent Flow Failed）：\n' +
        '1.【声纹不匹配】：参考音频与授权录音必须由同一真实说话人发音！Google 云端会强制做双轨声纹生物特征比对，严禁上传他人录音（如网络音频、动漫、他人素材）而自己读授权，否则 Google 将拒绝克隆。\n' +
        '2.【文案必须字字准确】：授权录音必须一字不差完整朗读指定法定声明（中文：「我是此声音的拥有者并授权谷歌使用此声音创建语音合成模型」），不能改字、漏字或提前截断。\n' +
        '3.【音质与录制时长】：参考音频建议 10 至 30 秒，授权录音至少 3 至 5 秒，录音请保持安静、无背景音乐干扰。'
      );
    }

    throw new Error(`创建声线失败：${rawMsg}${detailMsg}`);
  }

  const data = await res.json();
  const rawId = extractVoiceId(data);
  if (!rawId) {
    console.error('Google voices.create returned payload without voice ID:', data);
    throw new Error(`Google 声线创建已成功响应，但未能解析到有效的 voice ID。原始返回内容: ${JSON.stringify(data)}`);
  }

  const rawName = data.name || data.voice?.name || `voices/${rawId}`;
  const rawDisplayName = payload.displayName.trim() || data.display_name || data.displayName || data.voice?.display_name || data.voice?.displayName || '自定义克隆声线';

  return {
    id: rawId,
    name: rawName,
    displayName: rawDisplayName,
    type: 'replicated',
    createTime: data.create_time || data.createTime || data.voice?.create_time || new Date().toISOString(),
    tags: payload.tags || ['克隆声线', '专属声纹']
  };
}

/**
 * Fetch remote voices list from Google Cloud
 */
export async function listReplicatedVoices(apiKey: string): Promise<VoiceItem[]> {
  if (!apiKey) return [];

  try {
    const res = await apiFetch(`/v1beta/voices?key=${encodeURIComponent(apiKey)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey.trim()
      }
    });

    if (!res.ok) {
      console.warn('listReplicatedVoices HTTP Error', res.status);
      return [];
    }

    const data = await res.json();
    const rawList = Array.isArray(data)
      ? (Array.isArray(data[0]?.voices) ? data[0].voices : data)
      : (Array.isArray(data.voices) ? data.voices : []);

    return rawList
      .map((v: any) => {
        const item = v.voice || v;
        if (item.type === 'prebuilt') return null;
        const id = extractVoiceId(item);
        if (!id) return null;
        if (!item.type && !id.startsWith('voice_') && !id.startsWith('voicekey_')) return null;
        const displayName = item.display_name || item.displayName || item.name || id;
        return {
          id,
          name: item.name || `voices/${id}`,
          displayName: displayName,
          type: 'replicated' as const,
          createTime: item.create_time || item.createTime || item.expire_time || new Date().toISOString(),
          tags: ['云端同步', '克隆声线']
        };
      })
      .filter((v: VoiceItem | null): v is VoiceItem => v !== null);
  } catch (err) {
    console.warn('Failed to list remote voices', err);
    return [];
  }
}

/**
 * Delete a voice from Google Cloud
 */
export async function deleteReplicatedVoice(apiKey: string, voiceId: string): Promise<boolean> {
  if (!apiKey) throw new Error('API Key 未配置');
  const targetName = voiceId.startsWith('voices/') ? voiceId : `voices/${voiceId}`;

  const res = await apiFetch(`/v1beta/${targetName}?key=${encodeURIComponent(apiKey)}`, {
    method: 'DELETE'
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    console.warn('Delete remote voice error', errJson);
  }
  return true;
}

/**
 * LLM Director Mode using Gemini 4 Argon (with optional model selection)
 * Transforms input draft into cinema-grade speech script with vocal cues and speech_metadata style
 */
export async function directScriptWithLLM(
  apiKey: string,
  rawText: string,
  targetLanguage: string = 'zh-CN',
  moodStyle: string = '自然生动',
  llmModel: string = 'gemini-4-argon'
): Promise<DirectorResult> {
  if (!apiKey) throw new Error('API Key 未配置');
  if (!rawText.trim()) throw new Error('文案内容不能为空');

  const modelToUse = llmModel.trim() || 'gemini-4-argon';

  const systemPrompt = `你是一位好莱坞录音棚级语音配音导演。你的任务是将用户的原始草稿扩写润色为富有表现力、真实可感的有声台词。
要求：
1. 目标语言：${targetLanguage}
2. 情感氛围风格：${moodStyle}
3. 声音表现力增强：在台词中适度且精准地插入 Gemini 3.8 Flash TTS 原生支持的发音标记：
   - 语气词与停顿：[laugh]（笑声）、[sigh]（叹气）、[gasp]（倒吸凉气）、[cough]（轻咳）、[throat-clearing]（清嗓）、[short pause]（短顿 0.3s）、[medium pause]（中顿 0.7s）、[whispering]（耳语）。
   - 注意：绝不要滥用，在自然呼吸与情感转折处恰到好处地添加。
4. 生成结构化指导：
   - enhanced_text: 润色扩写并已插入标记的最终台词文本。
   - target_language: 目标语言代码或名称。
   - speech_style: 面向 speech_metadata.style 的精准英文/中文情绪提示（如 "cheerful and excited", "serious and slow-paced", "warm and empathetic"）。
   - director_notes: 简短的配音指导建议与语气要点提示。

必须输出合法标准的 JSON 格式：
{
  "enhanced_text": "...",
  "target_language": "...",
  "speech_style": "...",
  "director_notes": "..."
}`;

  const res = await apiFetch(`/v1beta/models/${encodeURIComponent(modelToUse)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: `${systemPrompt}\n\n【用户原始台词】：\n${rawText}` }]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || `导演处理失败 (${modelToUse}) HTTP ${res.status}`);
  }

  const data = await res.json();
  const parts: any[] = data?.candidates?.[0]?.content?.parts || [];
  const answerPart = [...parts].reverse().find(p => p && typeof p.text === 'string' && !p.thought) || parts[0];
  const textContent = answerPart?.text;
  if (!textContent) {
    throw new Error('未收到导演生成结果');
  }

  try {
    const cleanedJson = String(textContent)
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const parsed = JSON.parse(cleanedJson);
    return {
      enhancedText: parsed.enhanced_text || rawText,
      targetLanguage: parsed.target_language || targetLanguage,
      speechStyle: parsed.speech_style || moodStyle,
      directorNotes: parsed.director_notes || `由 ${modelToUse} 扩写生成`
    };
  } catch {
    return {
      enhancedText: String(textContent).trim(),
      targetLanguage,
      speechStyle: moodStyle,
      directorNotes: `由 ${modelToUse} 直接生成`
    };
  }
}

function extractAudioFromInteractionsData(data: any): string {
  if (!data) return '';
  const list = Array.isArray(data) ? data : [data];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;

    // 1. Direct output_audio field
    if (item.output_audio?.data) {
      return item.output_audio.data;
    }

    // 2. steps array with model_output
    if (Array.isArray(item.steps)) {
      for (const step of item.steps) {
        if (Array.isArray(step.content)) {
          for (const c of step.content) {
            if ((c.type === 'audio' || c.mime_type?.startsWith('audio/')) && c.data) {
              return c.data;
            }
          }
        }
      }
    }

    // 3. content array directly on item
    if (Array.isArray(item.content)) {
      for (const c of item.content) {
        if ((c.type === 'audio' || c.mime_type?.startsWith('audio/')) && c.data) {
          return c.data;
        }
      }
    }

    // 4. candidates format
    if (Array.isArray(item.candidates)) {
      for (const cand of item.candidates) {
        const parts = cand?.content?.parts;
        if (Array.isArray(parts)) {
          for (const p of parts) {
            if (p.inlineData?.data) {
              return p.inlineData.data;
            }
          }
        }
      }
    }
  }

  return '';
}

/**
 * Speech Synthesis using Gemini 3.8 Flash TTS
 * Primary: /v1beta/interactions (native support for custom replicated voices and 3.8 Flash TTS)
 * Secondary: /v1beta/models/...:generateContent (for prebuilt studio voices)
 */
export async function synthesizeSpeech(
  apiKey: string,
  payload: SynthesizePayload
): Promise<{ audioBase64: string; duration: number }> {
  if (!apiKey) throw new Error('API Key 未配置');
  if (!payload.text.trim()) throw new Error('请输入合成文本');

  const model = payload.model || 'gemini-3.8-flash-tts';
  const voiceTarget = payload.voiceId.startsWith('voices/') 
    ? payload.voiceId.replace('voices/', '') 
    : payload.voiceId;

  const isCustomVoice = voiceTarget.startsWith('voice_') || voiceTarget.startsWith('voicekey_');

  // Attempt 1: Standard Interactions API
  const interactionBody = {
    model,
    input: [
      {
        type: 'user_input',
        content: [
          {
            type: 'text',
            text: payload.text,
            ...(payload.stylePrompt ? {
              annotations: [
                {
                  type: 'speech_metadata',
                  style: payload.stylePrompt
                }
              ]
            } : {})
          }
        ]
      }
    ],
    response_format: {
      type: 'audio',
      mime_type: 'audio/wav'
    },
    generation_config: {
      speech_config: [
        {
          voice: voiceTarget
        }
      ]
    }
  };

  const res = await apiFetch(`/v1beta/interactions?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey.trim()
    },
    body: JSON.stringify(interactionBody)
  });

  if (res.ok) {
    const rawText = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(rawText);
    } catch {}

    const rawAudioBase64 = extractAudioFromInteractionsData(data);
    if (rawAudioBase64) {
      const audioBase64 = ensureWavBase64(rawAudioBase64);
      const duration = await calculateAudioDuration(audioBase64);
      return { audioBase64, duration };
    }
    console.warn('Interactions response received but failed to extract audio:', rawText);
  } else {
    const errText = await res.text().catch(() => '');
    let errJson: any = null;
    try {
      errJson = JSON.parse(errText);
    } catch {}

    const errMsg = Array.isArray(errJson)
      ? (errJson[0]?.error?.message || errText)
      : (errJson?.error?.message || errText || `HTTP ${res.status}: ${res.statusText}`);

    // If it's a custom cloned voice, generateContent does not support it. Throw immediately.
    if (isCustomVoice) {
      throw new Error(`语音合成失败（Interactions API）：${errMsg}`);
    }
    console.warn('Interactions API call failed, trying generateContent fallback for prebuilt voice:', errMsg);
  }

  // Attempt 2: generateContent Endpoint Fallback (ONLY for prebuilt Studio voices)
  if (!isCustomVoice) {
    const generateBody: Record<string, any> = {
      contents: [
        {
          parts: [{ text: payload.text }]
        }
      ],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voiceTarget
            }
          }
        }
      },
      ...(payload.stylePrompt ? {
        systemInstruction: {
          parts: [{ text: `Speech delivery style: ${payload.stylePrompt}` }]
        }
      } : {})
    };

    const genRes = await apiFetch(`/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey.trim()
      },
      body: JSON.stringify(generateBody)
    });

    if (!genRes.ok) {
      const errJson = await genRes.json().catch(() => ({}));
      throw new Error(errJson?.error?.message || `语音合成失败 HTTP ${genRes.status}: ${genRes.statusText}`);
    }

    const genData = await genRes.json();
    const part = genData?.candidates?.[0]?.content?.parts?.[0];
    const rawAudioBase64 = part?.inlineData?.data;

    if (rawAudioBase64) {
      const audioBase64 = ensureWavBase64(rawAudioBase64);
      const duration = await calculateAudioDuration(audioBase64);
      return { audioBase64, duration };
    }
  }

  throw new Error('未收到有效的音频合成数据，请检查声线配置或网络状态');
}

/**
 * Calculates accurate duration from Base64 WAV data using Web Audio
 */
async function calculateAudioDuration(base64: string): Promise<number> {
  try {
    const blob = base64ToBlob(base64, 'audio/wav');
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    try {
      const decoded = await audioCtx.decodeAudioData(arrayBuffer);
      return decoded.duration;
    } finally {
      if (audioCtx.state !== 'closed') {
        await audioCtx.close();
      }
    }
  } catch {
    // Rough estimate if decode fails: sample rate 24000, 16bit mono = 48000 bytes/sec
    const bytes = atob(base64).length;
    return Math.max(1, bytes / 48000);
  }
}
