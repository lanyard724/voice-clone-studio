#!/usr/bin/env node
/**
 * Voice Clone Studio - Standard MCP (Model Context Protocol) Stdio Server
 * Exposes non-CDP UI remote control, voice cloning, LLM director, TTS synthesis, and 10h+ batch jobs.
 */

import * as readline from 'readline';
import { runCli } from './cli.mjs';

const TOOLS = [
  {
    name: 'tts_studio_status',
    description: '获取 Gemini TTS 工作台运行状态、当前网页连接数、实时 UI 状态、声线数量与批处理队列。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'tts_studio_ui_control',
    description: '不通过 CDP 直接远程操控已打开的 Voice Clone Studio 网页 UI（切换标签页、填入台词、选择声线、修改情绪指令、触发合成或导演润色）。',
    inputSchema: {
      type: 'object',
      properties: {
        tab: { type: 'string', enum: ['studio', 'repository', 'history', 'batch'] },
        mode: { type: 'string', enum: ['passthrough', 'director'] },
        voice: { type: 'string', description: '声线 ID（如 kore, zephyr, puck, fenrir, charon, leda 或克隆声线 voice_...）' },
        text: { type: 'string', description: '填入合成输入框的台词文本' },
        style: { type: 'string', description: '情绪风格提示词（speech_metadata.style）' },
        preset: { type: 'string', description: '预设风格名称（如 自然平和、喜悦欢快、严肃庄重、深夜电台 等）' },
        draft: { type: 'string', description: '导演模式草稿文本' },
        lang: { type: 'string', description: '目标语言代码（如 zh-CN, en-US, ja-JP）' },
        mood: { type: 'string', description: '导演模式氛围要求' },
        'llm-model': {
          type: 'string',
          enum: ['gemini-4-argon', 'gemini-3.8-flash'],
          description: 'AI 导演大语言模型，默认 gemini-4-argon'
        },
        trigger: {
          type: 'string',
          enum: ['synthesize', 'director', 'sync-voices'],
          description: '可选：立即在网页端触发动作并等待完成回执'
        }
      }
    }
  },
  {
    name: 'tts_studio_synthesize',
    description: '调用 Gemini 3.8 Flash TTS 合成语音并导出 WAV 文件，同时自动将音频同步至网页播放器和历史记录。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要合成的台词文本' },
        file: { type: 'string', description: '可选：从本地文本文件读取台词' },
        voice: { type: 'string', description: '声线 ID，默认 kore' },
        style: { type: 'string', description: '情绪提示词' },
        model: { type: 'string', enum: ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'] },
        out: { type: 'string', description: '可选：自定义输出 WAV 路径' }
      }
    }
  },
  {
    name: 'tts_studio_batch',
    description: '启动或管理 10 小时以上超长文本断点续传批处理合成任务（自动按章节/句号切块、落盘防丢、FFmpeg 自动合并 MP3/WAV）。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'status', 'pause', 'resume', 'delete'] },
        file: { type: 'string', description: '长文本文件路径（action=start 时使用）' },
        text: { type: 'string', description: '长文本字符串（action=start 时使用）' },
        title: { type: 'string', description: '批处理任务标题' },
        voice: { type: 'string', description: '声线 ID' },
        style: { type: 'string', description: '情绪风格提示词' },
        chunkSize: { type: 'number', description: '单块最大字符数，默认 1000' },
        concurrency: { type: 'number', description: '并发数 1-5，默认 2' },
        id: { type: 'string', description: '任务 ID（pause/resume/delete/status 时使用）' }
      },
      required: ['action']
    }
  },
  {
    name: 'tts_studio_voices',
    description: '查询或从 Google 云端同步声线列表，或克隆新声线。',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'sync', 'delete', 'clone'] },
        id: { type: 'string', description: '删除声线时的声线 ID' },
        name: { type: 'string', description: '克隆声线时的显示名称' },
        source: { type: 'string', description: '克隆声线时的参考人声音频路径（10-30s）' },
        consent: { type: 'string', description: '克隆声线时的授权朗读音频路径' },
        lang: { type: 'string', description: '克隆声线语言代码，默认 zh-CN' }
      },
      required: ['action']
    }
  }
];

async function executeTool(name, args = {}) {
  const origLog = console.log;
  console.log = () => {};
  try {
    if (name === 'tts_studio_status') {
      return await runCli(['status']);
    }
    if (name === 'tts_studio_ui_control') {
      const cliArgs = ['ui'];
      for (const [k, v] of Object.entries(args)) {
        if (v !== undefined && v !== null) cliArgs.push(`--${k}`, String(v));
      }
      return await runCli(cliArgs);
    }
    if (name === 'tts_studio_synthesize') {
      const cliArgs = ['synth'];
      for (const [k, v] of Object.entries(args)) {
        if (v !== undefined && v !== null) cliArgs.push(`--${k}`, String(v));
      }
      return await runCli(cliArgs);
    }
    if (name === 'tts_studio_batch') {
      const cliArgs = ['batch', args.action || 'status'];
      if (args.id) cliArgs.push('--id', String(args.id));
      if (args.file) cliArgs.push('--file', String(args.file));
      if (args.text) cliArgs.push('--text', String(args.text));
      if (args.title) cliArgs.push('--title', String(args.title));
      if (args.voice) cliArgs.push('--voice', String(args.voice));
      if (args.style) cliArgs.push('--style', String(args.style));
      if (args.chunkSize) cliArgs.push('--chunk-size', String(args.chunkSize));
      if (args.concurrency) cliArgs.push('--concurrency', String(args.concurrency));
      return await runCli(cliArgs);
    }
    if (name === 'tts_studio_voices') {
      if (args.action === 'clone') {
        const cliArgs = ['clone'];
        if (args.name) cliArgs.push('--name', String(args.name));
        if (args.source) cliArgs.push('--source', String(args.source));
        if (args.consent) cliArgs.push('--consent', String(args.consent));
        if (args.lang) cliArgs.push('--lang', String(args.lang));
        return await runCli(cliArgs);
      }
      const cliArgs = ['voices', args.action || 'list'];
      if (args.id) cliArgs.push(String(args.id));
      return await runCli(cliArgs);
    }
    throw new Error(`Unknown tool: ${name}`);
  } finally {
    console.log = origLog;
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }

  const { id, method, params } = req;
  const reply = (result) => {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  };
  const replyError = (code, message) => {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
  };

  try {
    if (method === 'initialize') {
      return reply({
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'voice-clone-studio-mcp', version: '2.0.0' }
      });
    }
    if (method === 'notifications/initialized') return;
    if (method === 'tools/list') {
      return reply({ tools: TOOLS });
    }
    if (method === 'tools/call') {
      const data = await executeTool(params?.name, params?.arguments || {});
      return reply({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
      });
    }
    if (id !== undefined) {
      replyError(-32601, `Method not found: ${method}`);
    }
  } catch (err) {
    if (id !== undefined) {
      replyError(-32000, err?.message || String(err));
    }
  }
});
