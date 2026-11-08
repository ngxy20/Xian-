/**
 * Xian优化器 — DSH host plugin.
 *
 * Registers one exact Fetch route used by the composer button:
 *   POST /api/xian/optimize  { prompt, cwd, maxFiles?, maxChars?, refresh? }
 *   GET  /api/xian/health
 *
 * The route is owner-authenticated by dsh-client-connection's shared /api
 * bridge; no additional token is invented here.
 */

import path from 'node:path';
import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import {
  DEPTH_PRESETS,
  inspectProjectProfile,
  optimizePrompt,
  resolveDepth,
} from './core.mjs';

export const name = '@xian/optimizer';
export const inject = ['connection'];

const VERSION = '1.0.0';
const MAX_PROMPT_CHARS = 20_000;
const ASSETS = {
  face: new URL('../assets/face.webp', import.meta.url),
  side: new URL('../assets/side.webp', import.meta.url),
  front: new URL('../assets/front.webp', import.meta.url),
};
const assetCache = new Map();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function resolveRoot(value) {
  const candidate = typeof value === 'string' && value.trim() ? value.trim() : process.cwd();
  if (!path.isAbsolute(candidate)) return { error: 'cwd 必须是绝对路径。' };
  try {
    const stat = statSync(candidate);
    if (!stat.isDirectory()) return { error: 'cwd 不是目录。' };
  } catch {
    return { error: 'cwd 不存在或不可访问。' };
  }
  return { root: candidate };
}

async function readRequest(request) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return { response: json({ ok: false, error: { code: 'xian/content-type', message: '请求必须是 application/json。' } }, 415) };
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return { response: json({ ok: false, error: { code: 'xian/bad-json', message: '请求体不是合法 JSON。' } }, 400) };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { response: json({ ok: false, error: { code: 'xian/bad-body', message: '请求体必须是对象。' } }, 400) };
  }
  return { body };
}

function optionsFromBody(body) {
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!prompt.trim()) {
    return { response: json({ ok: false, error: { code: 'xian/empty-prompt', message: '请先在输入框写一句需求。' } }, 400) };
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return { response: json({ ok: false, error: { code: 'xian/prompt-too-long', message: `需求最多 ${MAX_PROMPT_CHARS} 字符。` } }, 413) };
  }
  const resolved = resolveRoot(body.cwd);
  if (resolved.error) {
    return { response: json({ ok: false, error: { code: 'xian/bad-cwd', message: resolved.error } }, 400) };
  }
  const depth = resolveDepth(body.depth);
  const preset = DEPTH_PRESETS[depth];
  return {
    prompt,
    root: resolved.root,
    depth,
    maxFiles: clamp(body.maxFiles, 1, 15, preset.maxFiles),
    maxChars: clamp(body.maxChars, 4000, 26_000, preset.maxChars),
    contentFallback: preset.contentFallback,
    refresh: body.refresh === true,
  };
}

function rootFromBody(body) {
  const resolved = resolveRoot(body.cwd);
  if (resolved.error) {
    return { response: json({ ok: false, error: { code: 'xian/bad-cwd', message: resolved.error } }, 400) };
  }
  return { root: resolved.root, refresh: body.refresh === true };
}

function resultPayload(result) {
  return {
    ok: true,
    version: VERSION,
    prompt: result.prompt,
    title: result.title,
    confidence: result.confidence,
    intent: result.intent,
    intents: result.intents,
    project: result.project,
    stats: result.stats,
    files: result.files,
    warnings: result.warnings,
    promptChars: result.promptChars,
    understanding: result.understanding,
  };
}

export function apply(ctx) {
  ctx.connection.fetch.register({
    path: '/api/xian/asset',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const name = new URL(request.url).searchParams.get('name') ?? '';
      const source = ASSETS[name];
      if (!source) return new Response('not found', { status: 404 });
      try {
        let body = assetCache.get(name);
        if (!body) {
          body = await readFile(source);
          assetCache.set(name, body);
        }
        return new Response(body, {
          headers: {
            'content-type': 'image/webp',
            'cache-control': 'public, max-age=3600',
          },
        });
      } catch {
        return new Response('not found', { status: 404 });
      }
    },
  });

  ctx.connection.fetch.register({
    path: '/api/xian/health',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => json({
      ok: true,
      name,
      version: VERSION,
      routes: ['/api/xian/optimize', '/api/xian/optimize-stream', '/api/xian/insight', '/api/xian/asset', '/api/xian/health'],
    }),
  });

  ctx.connection.fetch.register({
    path: '/api/xian/insight',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const parsed = await readRequest(request);
        if (parsed.response) return parsed.response;
        const resolved = rootFromBody(parsed.body);
        if (resolved.response) return resolved.response;
        const insight = await inspectProjectProfile(resolved.root, { refresh: resolved.refresh });
        return json({
          ok: true,
          version: VERSION,
          profile: insight.profile,
          summary: insight.summary,
        });
      } catch (error) {
        return json({
          ok: false,
          error: { code: 'xian/insight-failed', message: error instanceof Error ? error.message : String(error) },
        }, 500);
      }
    },
  });

  ctx.connection.fetch.register({
    path: '/api/xian/optimize',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        const parsed = await readRequest(request);
        if (parsed.response) return parsed.response;
        const options = optionsFromBody(parsed.body);
        if (options.response) return options.response;
        const result = await optimizePrompt(options.prompt, options);
        return json({
          ...resultPayload(result),
          depth: options.depth,
          depthLabel: DEPTH_PRESETS[options.depth].label,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = /不存在|不可访问|不是目录/.test(message) ? 400 : 500;
        return json({ ok: false, error: { code: 'xian/failed', message } }, status);
      }
    },
  });

  ctx.connection.fetch.register({
    path: '/api/xian/optimize-stream',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const parsed = await readRequest(request);
      if (parsed.response) return parsed.response;
      const options = optionsFromBody(parsed.body);
      if (options.response) return options.response;

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          let closed = false;
          const send = (event) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            } catch {
              closed = true;
            }
          };
          const report = (event) => send({ type: 'progress', ...event, at: Date.now() });
          optimizePrompt(options.prompt, { ...options, onProgress: report })
            .then((result) => {
              send({
                type: 'result',
                ...resultPayload(result),
                depth: options.depth,
                depthLabel: DEPTH_PRESETS[options.depth].label,
                at: Date.now(),
              });
              closed = true;
              controller.close();
            })
            .catch((error) => {
              send({
                type: 'error',
                ok: false,
                error: { code: 'xian/failed', message: error instanceof Error ? error.message : String(error) },
                at: Date.now(),
              });
              closed = true;
              controller.close();
            });
        },
      });
      return new Response(stream, {
        headers: {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-store',
          'x-accel-buffering': 'no',
        },
      });
    },
  });
}
