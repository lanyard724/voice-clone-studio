import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import type { Plugin, ViteDevServer } from 'vite';
import {
  BATCH_DIR,
  BatchJobManifest,
  BatchJobSummary,
  ensureStudioDirs,
  readStudioDb,
  writeStudioDb,
  getHistoryAudioBuffer,
  proxyFetchRaw,
  backendSynthesizeChunk,
  splitTextIntoChunks,
  stitchBatchAudio
} from './core';

const activeBatchRunners = new Map<string, { paused: boolean }>();

export function studioBridgePlugin(): Plugin {
  const sseClients = new Set<http.ServerResponse>();
  let latestUiState: Record<string, any> = {
    connected: false,
    updatedAt: 0
  };
  const pendingCommandAcks = new Map<
    string,
    { resolve: (val: any) => void; timer: NodeJS.Timeout }
  >();

  const broadcastSse = (event: string, data: any, singleTargetOnly = false) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    if (singleTargetOnly && sseClients.size > 0) {
      const clientsArr = Array.from(sseClients);
      const target = clientsArr[clientsArr.length - 1];
      try {
        target.write(payload);
        return;
      } catch {
        sseClients.delete(target);
      }
    }

    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  };

  const toJobSummary = (manifest: BatchJobManifest): BatchJobSummary => {
    const { chunks: _omitted, ...summary } = manifest;
    return summary;
  };

  const saveBatchManifest = (manifest: BatchJobManifest) => {
    const jobDir = path.join(BATCH_DIR, manifest.id);
    if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });
    manifest.updatedAt = Date.now();

    const mPath = path.join(jobDir, 'manifest.json');
    const tmpPath = `${mPath}.tmp.${process.pid}.${Date.now()}`;
    const payload = JSON.stringify(manifest, null, 2);
    try {
      fs.writeFileSync(tmpPath, payload, 'utf-8');
      fs.renameSync(tmpPath, mPath);
    } catch {
      fs.writeFileSync(mPath, payload, 'utf-8');
    }

    const db = readStudioDb();
    const summary = toJobSummary(manifest);
    const idx = db.batchJobs.findIndex((j) => j.id === manifest.id);
    if (idx >= 0) {
      db.batchJobs[idx] = summary;
    } else {
      db.batchJobs.unshift(summary);
    }
    writeStudioDb(db);
    broadcastSse('batch-progress', summary);
  };

  const loadBatchManifest = (jobId: string): BatchJobManifest | null => {
    const mPath = path.join(BATCH_DIR, jobId, 'manifest.json');
    if (!fs.existsSync(mPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(mPath, 'utf-8'));
    } catch {
      return null;
    }
  };

  const runBatchJobLoop = async (jobId: string) => {
    if (activeBatchRunners.has(jobId)) return;
    const runner = { paused: false };
    activeBatchRunners.set(jobId, runner);

    try {
      const manifest = loadBatchManifest(jobId);
      if (!manifest) return;

      const db = readStudioDb();
      const apiKey = db.settings.apiKey;
      if (!apiKey) {
        manifest.status = 'failed';
        manifest.error = '未配置 Gemini API Key';
        saveBatchManifest(manifest);
        return;
      }

      manifest.status = 'running';
      manifest.error = undefined;
      saveBatchManifest(manifest);

      const jobDir = path.join(BATCH_DIR, manifest.id);
      const chunksDir = path.join(jobDir, 'chunks');
      if (!fs.existsSync(chunksDir)) fs.mkdirSync(chunksDir, { recursive: true });

      const pendingIndices = manifest.chunks
        .filter((c) => c.status !== 'completed')
        .map((c) => c.index);

      let cursor = 0;
      const concurrency = Math.max(1, Math.min(5, manifest.concurrency || 2));

      const worker = async () => {
        while (cursor < pendingIndices.length && !runner.paused) {
          const idx = pendingIndices[cursor++];
          const chunk = manifest.chunks[idx];
          if (!chunk || chunk.status === 'completed') continue;

          chunk.status = 'running';
          saveBatchManifest(manifest);

          let success = false;
          for (let attempt = 0; attempt < 4; attempt++) {
            if (runner.paused) break;
            try {
              const currentDb = readStudioDb();
              const { wavBuffer, durationSec } = await backendSynthesizeChunk({
                apiKey: currentDb.settings.apiKey,
                proxyUrl: currentDb.settings.proxyUrl,
                text: chunk.text,
                voiceId: manifest.voiceId,
                stylePrompt: manifest.stylePrompt,
                model: manifest.model
              });

              const fileName = `chunk_${String(idx + 1).padStart(4, '0')}.wav`;
              fs.writeFileSync(path.join(chunksDir, fileName), wavBuffer);
              chunk.status = 'completed';
              chunk.file = fileName;
              chunk.duration = durationSec;
              chunk.error = undefined;
              success = true;
              break;
            } catch (err: any) {
              chunk.retries = (chunk.retries || 0) + 1;
              chunk.error = err?.message || String(err);
              const backoffMs = 2000 * Math.pow(2, attempt);
              await new Promise((r) => setTimeout(r, backoffMs));
            }
          }

          if (!success && !runner.paused) {
            chunk.status = 'failed';
          }

          manifest.completedChunks = manifest.chunks.filter((c) => c.status === 'completed').length;
          manifest.failedChunks = manifest.chunks.filter((c) => c.status === 'failed').length;
          manifest.totalDurationSec = Number(
            manifest.chunks.reduce((acc, c) => acc + (c.duration || 0), 0).toFixed(2)
          );
          saveBatchManifest(manifest);
        }
      };

      await Promise.all(Array.from({ length: concurrency }, () => worker()));

      if (runner.paused) {
        manifest.status = 'paused';
        saveBatchManifest(manifest);
        return;
      }

      if (manifest.completedChunks === manifest.totalChunks) {
        const merged = await stitchBatchAudio(jobDir, manifest);
        if (merged.error) {
          manifest.status = 'failed';
          manifest.error = merged.error;
        } else {
          manifest.outputWavPath = merged.wavPath;
          manifest.outputMp3Path = merged.mp3Path;
          manifest.status = 'completed';
        }
      } else {
        manifest.status = 'failed';
        manifest.error = `${manifest.failedChunks} 个切片合成失败，可点击断点续传继续任务`;
      }
      saveBatchManifest(manifest);
    } finally {
      activeBatchRunners.delete(jobId);
    }
  };

  return {
    name: 'voice-clone-studio-bridge',
    configureServer(server: ViteDevServer) {
      ensureStudioDirs();

      const readJsonBody = (req: http.IncomingMessage): Promise<any> =>
        new Promise((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
          req.on('end', () => {
            try {
              const str = Buffer.concat(chunks).toString('utf-8');
              resolve(str ? JSON.parse(str) : {});
            } catch (e) {
              reject(e);
            }
          });
          req.on('error', reject);
        });

      const sendJson = (res: http.ServerResponse, status: number, data: any) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(JSON.stringify(data));
      };

      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        if (!url.startsWith('/api/')) {
          return next();
        }

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          res.end();
          return;
        }

        try {
          // 1. SSE Event Stream
          if (url.startsWith('/api/events') && req.method === 'GET') {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'Access-Control-Allow-Origin': '*'
            });
            res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
            sseClients.add(res);
            req.on('close', () => {
              sseClients.delete(res);
            });
            return;
          }

          // 2. Offloaded History Audio Stream Endpoint
          if (url.startsWith('/api/audio') && req.method === 'GET') {
            const u = new URL(url, 'http://localhost:5174');
            const id = u.searchParams.get('id') || '';
            const buf = getHistoryAudioBuffer(id);
            if (!buf) {
              return sendJson(res, 404, { error: 'Audio file not found' });
            }
            res.writeHead(200, {
              'Content-Type': 'audio/wav',
              'Content-Length': String(buf.length),
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=86400'
            });
            res.end(buf);
            return;
          }

          // 3. Status Endpoint
          if (url.startsWith('/api/status') && req.method === 'GET') {
            const db = readStudioDb();
            return sendJson(res, 200, {
              ok: true,
              connectedBrowserClients: sseClients.size,
              uiState: {
                ...latestUiState,
                connected: sseClients.size > 0
              },
              settings: {
                apiKeyConfigured: Boolean(db.settings.apiKey && db.settings.apiKey.trim()),
                apiKeyMasked: db.settings.apiKey
                  ? `${db.settings.apiKey.slice(0, 6)}...${db.settings.apiKey.slice(-4)}`
                  : '',
                proxyUrl: db.settings.proxyUrl,
                defaultModel: db.settings.defaultModel,
                llmModel: db.settings.llmModel || 'gemini-4-argon',
                autoPlay: db.settings.autoPlay
              },
              voicesCount: db.voices.length,
              historyCount: db.history.length,
              batchJobs: db.batchJobs
            });
          }

          // 4. Persistent State GET / POST (Authoritative Single Source of Truth)
          if (url.startsWith('/api/state')) {
            if (req.method === 'GET') {
              return sendJson(res, 200, readStudioDb());
            }
            if (req.method === 'POST') {
              const body = await readJsonBody(req);
              const db = readStudioDb();
              if (body.settings && typeof body.settings === 'object') {
                const nextSettings = { ...db.settings, ...body.settings };
                // Allow explicit clearing when body.settings.apiKey is provided as string
                if (typeof body.settings.apiKey === 'string') {
                  nextSettings.apiKey = body.settings.apiKey.trim();
                } else {
                  nextSettings.apiKey = db.settings.apiKey;
                }
                db.settings = nextSettings;
              }
              if (Array.isArray(body.voices)) {
                db.voices = body.voices;
              }
              if (Array.isArray(body.history)) {
                db.history = body.history;
              }
              writeStudioDb(db);
              if (body.broadcast !== false) {
                broadcastSse('state-updated', { timestamp: Date.now() });
              }
              return sendJson(res, 200, { ok: true, state: readStudioDb() });
            }
          }

          // 5. Browser UI State Report & Command ACK
          if (url.startsWith('/api/ui-report') && req.method === 'POST') {
            const body = await readJsonBody(req);
            if (body.uiState) {
              latestUiState = {
                ...body.uiState,
                connected: true,
                updatedAt: Date.now()
              };
            }
            if (body.commandId && pendingCommandAcks.has(body.commandId)) {
              const pending = pendingCommandAcks.get(body.commandId)!;
              clearTimeout(pending.timer);
              pendingCommandAcks.delete(body.commandId);
              pending.resolve({
                ok: body.ok !== false,
                result: body.result,
                error: body.error,
                uiState: latestUiState
              });
            }
            return sendJson(res, 200, { ok: true });
          }

          // 6. Remote Control Endpoint (Single-target dispatch for side-effect actions)
          if (url.startsWith('/api/control') && req.method === 'POST') {
            const body = await readJsonBody(req);
            const commandId = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const waitMs = Number(body.waitMs) || 15000;

            if (sseClients.size === 0) {
              return sendJson(res, 200, {
                ok: false,
                error: '当前没有活跃的浏览器标签页连接到工作台（请确认 http://localhost:5174 已打开）',
                connectedClients: 0
              });
            }

            const ackPromise = new Promise((resolve) => {
              const timer = setTimeout(() => {
                pendingCommandAcks.delete(commandId);
                resolve({
                  ok: true,
                  timeout: true,
                  message: '指令已下发至网页端（等待回执超时）',
                  uiState: latestUiState
                });
              }, waitMs);
              pendingCommandAcks.set(commandId, { resolve, timer });
            });

            const isSideEffectAction = ['trigger-synthesize', 'trigger-director', 'sync-voices'].includes(
              body.action
            );

            broadcastSse(
              'remote-command',
              {
                commandId,
                action: body.action,
                payload: body.payload || {}
              },
              isSideEffectAction
            );

            const ackResult = await ackPromise;
            return sendJson(res, 200, ackResult);
          }

          // 7. Proxy Fetch Endpoint
          if (url.startsWith('/api/proxy') && req.method === 'POST') {
            const body = await readJsonBody(req);
            const result = await proxyFetchRaw({
              url: body.url,
              method: body.method,
              headers: body.headers,
              body: body.body,
              proxyUrl: body.proxyUrl
            });
            return sendJson(res, 200, result);
          }

          // 8. Long-Form Batch Synthesis API
          if (url.startsWith('/api/batch')) {
            if (req.method === 'GET') {
              const u = new URL(url, 'http://localhost:5174');
              const jobId = u.searchParams.get('id');
              if (jobId) {
                const m = loadBatchManifest(jobId);
                return sendJson(res, m ? 200 : 404, m || { error: '任务不存在' });
              }
              return sendJson(res, 200, { jobs: readStudioDb().batchJobs });
            }

            if (req.method === 'POST') {
              const body = await readJsonBody(req);
              const action = body.action || 'create';

              if (action === 'create') {
                const rawText = String(body.text || '').trim();
                if (!rawText) {
                  return sendJson(res, 400, { ok: false, error: '批处理文本不能为空' });
                }
                const chunkSize = Math.max(200, Math.min(2500, Number(body.chunkSize) || 1000));
                const textChunks = splitTextIntoChunks(rawText, chunkSize);
                const jobId = `batch_${Date.now()}`;
                const db = readStudioDb();

                const manifest: BatchJobManifest = {
                  id: jobId,
                  title:
                    body.title ||
                    `长篇合成_${new Date().toLocaleTimeString('zh-CN', { hour12: false }).replace(/:/g, '')}`,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                  voiceId: body.voiceId || 'kore',
                  stylePrompt: body.stylePrompt || 'calm, natural, and balanced cadence',
                  model: body.model || db.settings.defaultModel || 'gemini-3.8-flash-tts',
                  chunkSize,
                  concurrency: Number(body.concurrency) || 2,
                  pauseMs: Number(body.pauseMs ?? 350),
                  status: 'queued',
                  totalChars: rawText.length,
                  totalChunks: textChunks.length,
                  completedChunks: 0,
                  failedChunks: 0,
                  totalDurationSec: 0,
                  chunks: textChunks.map((t, idx) => ({
                    index: idx,
                    text: t,
                    status: 'pending',
                    retries: 0
                  }))
                };

                saveBatchManifest(manifest);
                if (body.autoStart !== false) {
                  runBatchJobLoop(jobId);
                }
                return sendJson(res, 200, { ok: true, job: toJobSummary(manifest) });
              }

              if (action === 'pause') {
                const runner = activeBatchRunners.get(body.jobId);
                if (runner) runner.paused = true;
                return sendJson(res, 200, { ok: true });
              }

              if (action === 'resume') {
                runBatchJobLoop(body.jobId);
                return sendJson(res, 200, { ok: true });
              }

              if (action === 'delete') {
                const runner = activeBatchRunners.get(body.jobId);
                if (runner) runner.paused = true;
                const db = readStudioDb();
                db.batchJobs = db.batchJobs.filter((j) => j.id !== body.jobId);
                writeStudioDb(db);
                const jobDir = path.join(BATCH_DIR, body.jobId);
                if (fs.existsSync(jobDir)) {
                  fs.rmSync(jobDir, { recursive: true, force: true });
                }
                broadcastSse('state-updated', { timestamp: Date.now() });
                return sendJson(res, 200, { ok: true });
              }
            }
          }

          return sendJson(res, 404, { error: `Unknown endpoint ${url}` });
        } catch (err: any) {
          console.error('[StudioBridge Error]', err);
          return sendJson(res, 500, { ok: false, error: err?.message || String(err) });
        }
      });
    }
  };
}
