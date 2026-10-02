import {
  VoiceItem,
  CloneVoicePayload,
  DirectorResult,
  SynthesizePayload,
  ConnectionTestResult
} from './types';
import { base64ToBlob } from '../utils/audioConverter';

const API_BASE = 'https://generativelanguage.googleapis.com';

/**
 * Universal fetch wrapper that checks for IPC proxy execution if in Electron,
 * or falls back to browser fetch.
 */
async function apiFetch(endpoint: string, options: RequestInit): Promise<Response> {
  if (window.electronAPI?.request) {
    try {
      const result = await window.electronAPI.request({
        url: endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`,
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
      console.warn('IPC request failed, fallback to native fetch', err);
    }
  }
  const fullUrl = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
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
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || `创建声线失败 HTTP ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();
  const rawId = data.voice_id || data.name?.replace('voices/', '') || `voice_${Date.now()}`;

  return {
    id: rawId,
    name: data.name || `voices/${rawId}`,
    displayName: payload.displayName.trim() || data.display_name || '自定义克隆声线',
    type: 'replicated',
    createTime: data.create_time || new Date().toISOString(),
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
      method: 'GET'
    });

    if (!res.ok) {
      console.warn('listReplicatedVoices HTTP Error', res.status);
      return [];
    }

    const data = await res.json();
    const rawList = data.voices || [];

    return rawList
      .filter((v: { type?: string }) => v.type === 'replicated')
      .map((v: { name?: string; voice_id?: string; display_name?: string; create_time?: string }) => {
        const id = v.voice_id || v.name?.replace('voices/', '') || '';
        return {
          id,
          name: v.name || `voices/${id}`,
          displayName: v.display_name || id,
          type: 'replicated' as const,
          createTime: v.create_time,
          tags: ['云端同步', '克隆声线']
        };
      });
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
 * LLM Director Mode using Gemini 3.8 Flash
 * Transforms input draft into cinema-grade speech script with vocal cues and speech_metadata style
 */
export async function directScriptWithLLM(
  apiKey: string,
  rawText: string,
  targetLanguage: string = 'zh-CN',
  moodStyle: string = '自然生动'
): Promise<DirectorResult> {
  if (!apiKey) throw new Error('API Key 未配置');
  if (!rawText.trim()) throw new Error('文案内容不能为空');

  const systemPrompt = `你是一位好莱坞录音棚级语音配音导演。你的任务是将用户的原始草稿扩写润色为富有表现力、真实可感的有声台词。
要求：
1. 目标语言：${targetLanguage}
2. 情感氛围风格：${moodStyle}
3. 声音表现力增强：在台词中适度且精准地插入 Gemini 3.8 Flash TTS 原生支持的发音标记：
   - 语气词与停顿：<laugh>（笑声）、<sigh>（叹气）、<gasp>（倒吸凉气）、<cough>（轻咳）、<throat-clearing>（清嗓）、<short pause>（短顿 0.3s）、<medium pause>（中顿 0.7s）。
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

  const res = await apiFetch(`/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
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
    throw new Error(errJson?.error?.message || `导演处理失败 HTTP ${res.status}`);
  }

  const data = await res.json();
  const textContent = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textContent) {
    throw new Error('未收到导演生成结果');
  }

  try {
    const parsed = JSON.parse(textContent);
    return {
      enhancedText: parsed.enhanced_text || rawText,
      targetLanguage: parsed.target_language || targetLanguage,
      speechStyle: parsed.speech_style || moodStyle,
      directorNotes: parsed.director_notes || ''
    };
  } catch {
    return {
      enhancedText: textContent.trim(),
      targetLanguage,
      speechStyle: moodStyle,
      directorNotes: '由 Gemini 3.8 Flash 直接生成'
    };
  }
}

/**
 * Speech Synthesis using Gemini 3.8 Flash TTS
 * Supports both /v1beta/interactions and generateContent fallback
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

  // Attempt 1: Standard Interactions API
  try {
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
      response_format: { type: 'audio' },
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(interactionBody)
    });

    if (res.ok) {
      const data = await res.json();
      let audioBase64 = '';

      if (data.output_audio?.data) {
        audioBase64 = data.output_audio.data;
      } else if (Array.isArray(data.steps)) {
        for (const step of data.steps) {
          if (step.type === 'model_output' && Array.isArray(step.content)) {
            for (const item of step.content) {
              if (item.type === 'audio' && item.data) {
                audioBase64 = item.data;
                break;
              }
            }
          }
          if (audioBase64) break;
        }
      }

      if (audioBase64) {
        const duration = await calculateAudioDuration(audioBase64);
        return { audioBase64, duration };
      }
    }
  } catch (err) {
    console.warn('Interactions API call encountered error, attempting generateContent fallback', err);
  }

  // Attempt 2: generateContent Endpoint Fallback
  const generateBody = {
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
    }
  };

  const genRes = await apiFetch(`/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(generateBody)
  });

  if (!genRes.ok) {
    const errJson = await genRes.json().catch(() => ({}));
    throw new Error(errJson?.error?.message || `语音合成失败 HTTP ${genRes.status}: ${genRes.statusText}`);
  }

  const genData = await genRes.json();
  const part = genData?.candidates?.[0]?.content?.parts?.[0];
  const audioBase64 = part?.inlineData?.data;

  if (!audioBase64) {
    throw new Error('未收到有效的音频合成数据');
  }

  const duration = await calculateAudioDuration(audioBase64);
  return { audioBase64, duration };
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
