import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { proxyPool } from './server/proxyPool';
import { orchestrator } from './server/orchestrator';
import { fetchTargetMetadata, getWarmProfilesCount } from './server/browserEngine';
import { eventBus } from './server/eventBus';
import { clampMinWatchSeconds, isRetryableProxyErrorMessage } from './src/lib/targetMatcher';
import type { ProxyProtocol, RunConfig, SSEMessage } from './src/types/automation';

const PORT = Number(process.env.PORT || 3000);
const PROOFS_DIR = path.resolve(process.cwd(), 'data', 'proofs');

process.on('uncaughtException', (err) => {
  const msg = err?.message || String(err);
  if (isRetryableProxyErrorMessage(msg)) {
    return;
  }
  console.error('Unexpected uncaught exception:', err?.stack || msg);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  if (isRetryableProxyErrorMessage(msg)) {
    return;
  }
  console.error('Unexpected unhandled rejection:', reason);
});

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // SSE stream for real-time proxy probe & isolated session execution updates
  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const send = (msg: SSEMessage) => {
      res.write(`data: ${JSON.stringify(msg)}\n\n`);
    };

    send({ type: 'harvest-progress', payload: proxyPool.getProgress() });

    const listener = (msg: SSEMessage) => send(msg);
    eventBus.on('sse', listener);

    const keepAlive = setInterval(() => {
      res.write(': ping\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      eventBus.off('sse', listener);
    });
  });

  // Proxy pool endpoints
  app.get('/api/proxies', (_req, res) => {
    res.json({
      progress: proxyPool.getProgress(),
      verifiedUniqueCount: proxyPool.getVerifiedUniqueProxies().length,
      warmProfilesCount: getWarmProfilesCount(),
      proxies: proxyPool.getAllProxies(),
    });
  });

  app.post('/api/proxies/harvest', (req, res) => {
    const targetUniqueCount = Number(req.body?.targetUniqueCount ?? 45);
    proxyPool.harvestAndVerify(targetUniqueCount).catch((err) => {
      console.error('Proxy harvest error:', err);
    });
    res.json({ ok: true, progress: proxyPool.getProgress() });
  });

  app.post('/api/proxies/reverify', (_req, res) => {
    proxyPool.reverifyVerifiedProxies().catch((err) => {
      console.error('Proxy reverify error:', err);
    });
    res.json({ ok: true, progress: proxyPool.getProgress() });
  });

  app.post('/api/proxies/stop', (_req, res) => {
    proxyPool.stopHarvest();
    res.json({ ok: true, progress: proxyPool.getProgress() });
  });

  app.post('/api/proxies/import', async (req, res) => {
    try {
      const rawText = String(req.body?.rawText ?? '');
      const defaultProtocol = (req.body?.defaultProtocol ?? 'http') as ProxyProtocol;
      if (!rawText.trim()) {
        res.status(400).json({ error: 'Proxy listesi boş olamaz.' });
        return;
      }
      const result = await proxyPool.importAndVerifyCustomProxies(rawText, defaultProtocol);
      res.json({
        ok: true,
        ...result,
        verifiedUniqueCount: proxyPool.getVerifiedUniqueProxies().length,
        proxies: proxyPool.getAllProxies(),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'İçe aktarım hatası' });
    }
  });

  app.delete('/api/proxies', (_req, res) => {
    proxyPool.clearAll();
    res.json({ ok: true });
  });

  // Run orchestrator endpoints
  app.get('/api/runs', (_req, res) => {
    res.json({ runs: orchestrator.getAllRuns() });
  });

  app.get('/api/runs/:id', (req, res) => {
    const run = orchestrator.getRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: 'Görev kaydı bulunamadı.' });
      return;
    }
    res.json({ run });
  });

  app.get('/api/target-preview', async (req, res) => {
    try {
      const targetUrl = String(req.query.url ?? '').trim();
      if (!targetUrl) {
        res.json({ title: null, author: null });
        return;
      }
      const meta = await fetchTargetMetadata(targetUrl);
      res.json({
        title: meta.title ?? null,
        author: meta.author ?? null,
      });
    } catch {
      res.json({ title: null, author: null });
    }
  });

  app.post('/api/runs', async (req, res) => {
    try {
      const body = req.body as Partial<RunConfig>;
      const config: RunConfig = {
        mode: body.mode === 'identity-osint' ? 'identity-osint' : 'exact-link',
        targetUrl: String(body.targetUrl ?? '').trim(),
        searchQuery: String(body.searchQuery ?? '').trim(),
        username: String(body.username ?? '').trim(),
        clues: String(body.clues ?? '').trim(),
        referenceImageDataUrl:
          typeof body.referenceImageDataUrl === 'string' && body.referenceImageDataUrl.startsWith('data:image/')
            ? body.referenceImageDataUrl
            : null,
        desiredSessionCount: Math.max(1, Math.min(60, Number(body.desiredSessionCount ?? 30))),
        maxSearchPages: Math.max(1, Math.min(5, Number(body.maxSearchPages ?? 3))),
        minWatchSeconds: clampMinWatchSeconds(body.minWatchSeconds, 60),
        autoEnrichQuery: body.autoEnrichQuery !== false,
        enableProfileWarmup: body.enableProfileWarmup !== false,
        humanizeWatchCurve: body.humanizeWatchCurve !== false,
        enableSessionDepth: body.enableSessionDepth !== false,
        strictExactClickOnly: body.strictExactClickOnly !== false,
        captureProofScreenshot: body.captureProofScreenshot !== false,
        allowDirectSessionFallback: Boolean(body.allowDirectSessionFallback),
        autoDismissCookies: body.autoDismissCookies !== false,
        autoClickActionButton: body.autoClickActionButton !== false,
        actionButtonSelector: String(body.actionButtonSelector ?? '').trim().slice(0, 120),
      };

      const run = await orchestrator.startRun(config);
      res.status(201).json({ run });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Görev başlatılamadı.' });
    }
  });

  app.post('/api/runs/:id/stop', (req, res) => {
    const run = orchestrator.stopRun(req.params.id);
    if (!run) {
      res.status(404).json({ error: 'Görev bulunamadı.' });
      return;
    }
    res.json({ run });
  });

  // Serve real Chromium verification screenshots
  app.get('/api/proofs/:filename', (req, res) => {
    const safeName = path.basename(req.params.filename);
    const filePath = path.join(PROOFS_DIR, safeName);
    if (!fs.existsSync(filePath)) {
      res.status(404).send('Not found');
      return;
    }
    res.sendFile(filePath);
  });

  // Vite dev middleware or static dist in production
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NexusIP server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
