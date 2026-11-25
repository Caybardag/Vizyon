import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  ProfileDiscoveryHit,
  ProxyEndpoint,
  RunConfig,
  RunRecord,
  SessionExecution,
} from '../src/types/automation';
import {
  computeImageDHash,
  fetchTargetMetadata,
  pickFingerprint,
  runExactLinkSession,
  runOsintPlatformCheck,
} from './browserEngine';
import type { TargetMetadataHint } from '../src/lib/targetMatcher';
import { eventBus } from './eventBus';
import { proxyPool } from './proxyPool';
import {
  clampMinWatchSeconds,
  isQuarantineWorthyBlock,
  isRetryableProxyErrorMessage,
} from '../src/lib/targetMatcher';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const RUNS_FILE = path.join(DATA_DIR, 'runs.json');

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

class RunOrchestrator {
  private runs = new Map<string, RunRecord>();
  private abortControllers = new Map<string, AbortController>();

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    ensureDataDir();
    if (!fs.existsSync(RUNS_FILE)) return;
    try {
      const raw = fs.readFileSync(RUNS_FILE, 'utf8');
      const items = JSON.parse(raw) as RunRecord[];
      for (const item of items) {
        if (item.status === 'running') {
          item.status = 'stopped';
        }
        this.runs.set(item.id, item);
      }
    } catch {
      // Ignore corrupt runs history
    }
  }

  private saveToDisk(): void {
    ensureDataDir();
    const list = this.getAllRuns().slice(0, 30);
    fs.writeFileSync(RUNS_FILE, JSON.stringify(list, null, 2), 'utf8');
  }

  getAllRuns(): RunRecord[] {
    return Array.from(this.runs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  getRun(id: string): RunRecord | undefined {
    return this.runs.get(id);
  }

  stopRun(id: string): RunRecord | undefined {
    const ctrl = this.abortControllers.get(id);
    if (ctrl) {
      ctrl.abort();
      this.abortControllers.delete(id);
    }
    const run = this.runs.get(id);
    if (run && run.status === 'running') {
      run.status = 'stopped';
      run.finishedAt = new Date().toISOString();
      this.saveToDisk();
      eventBus.broadcast({ type: 'run-updated', payload: run });
    }
    return run;
  }

  async startRun(config: RunConfig): Promise<RunRecord> {
    if (config.mode === 'exact-link' && !config.targetUrl.trim()) {
      throw new Error('Hedef bağlantı (ör. YouTube video URL) zorunludur.');
    }
    if (config.mode === 'identity-osint' && !config.username.trim()) {
      throw new Error('Kullanıcı adı zorunludur.');
    }

    const desiredCount = Math.max(1, Math.min(60, config.desiredSessionCount || 30));
    const verifiedProxies = proxyPool.getVerifiedUniqueProxies();

    if (!config.allowDirectSessionFallback && verifiedProxies.length < desiredCount) {
      throw new Error(
        `En az ${desiredCount} benzersiz doğrulanmış IP gerekiyor (mevcut: ${verifiedProxies.length}). Lütfen önce IP & Oturum Havuzunu tarayın veya özel proxy ekleyin.`
      );
    }

    const runId = `run-${crypto.randomBytes(4).toString('hex')}`;
    const abortController = new AbortController();
    this.abortControllers.set(runId, abortController);

    // Build isolated session assignments mapped 1-to-1 to distinct verified exit IPs
    const assignedProxies: Array<ProxyEndpoint | null> = [];
    if (verifiedProxies.length > 0) {
      for (let i = 0; i < desiredCount; i++) {
        if (i < verifiedProxies.length) {
          assignedProxies.push(verifiedProxies[i]);
        } else if (config.allowDirectSessionFallback) {
          assignedProxies.push(verifiedProxies[i % verifiedProxies.length]);
        }
      }
    } else if (config.allowDirectSessionFallback) {
      for (let i = 0; i < desiredCount; i++) {
        assignedProxies.push(null);
      }
    }

    const targetWatchSeconds = clampMinWatchSeconds(config.minWatchSeconds, 60);

    const initialSessions: SessionExecution[] = assignedProxies.map((proxy, idx) => {
      const fp = pickFingerprint(idx + 1, proxy?.countryCode, {
        timezone: proxy?.timezone,
        lat: proxy?.lat,
        lon: proxy?.lon,
      });
      return {
        sessionId: `${runId}-ctx-${String(idx + 1).padStart(2, '0')}`,
        sessionIndex: idx + 1,
        proxyId: proxy ? proxy.id : 'direct-local',
        proxyAddress: proxy ? `${proxy.host}:${proxy.port}` : 'Yerel Doğrudan Oturum',
        protocol: proxy ? proxy.protocol : 'https',
        exitIp: proxy?.exitIp || 'Yerel Çıkış',
        country: proxy?.country || 'Direct',
        countryCode: proxy?.countryCode ?? null,
        networkType: proxy?.networkType || 'unknown',
        userAgent: fp.userAgent,
        locale: fp.locale,
        timezoneId: fp.timezoneId,
        osPlatform: `${fp.uaPlatform} (${fp.platform})`,
        webglRenderer: fp.webglRenderer,
        screenResolution: `${fp.screen.width}x${fp.screen.height}`,
        consistencyScore: fp.consistencyScore,
        cdpHardened: true,
        tlsProfile: fp.tlsProfile,
        behaviorMode: config.humanizeWatchCurve !== false ? 'bezier-human' : 'standard',
        failoverCount: 0,
        status: 'queued',
        searchQuery: config.searchQuery || config.targetUrl || config.username,
        matchedQuery: null,
        foundAtPage: null,
        foundAtRank: null,
        candidatesInspected: 0,
        candidatesSkipped: 0,
        matchedUrl: null,
        resolvedTitle: null,
        httpStatus: null,
        durationMs: null,
        screenshotUrl: null,
        error: null,
        consentDismissed: false,
        consentButtonLabel: null,
        trafficStatus: 'unknown',
        trafficGateReason: null,
        actionButtonClicked: null,
        watchSecondsActual: 0,
        targetWatchSeconds,
        videoDurationSeconds: null,
        playbackStatus: 'idle',
        profileState: 'cold',
        watchtimePingCount: 0,
        lastWatchtimePingStatus: null,
        sessionDepthUrl: null,
        sessionDepthTitle: null,
        decisions: [],
        updatedAt: new Date().toISOString(),
      };
    });

    const uniqueIpsUsed = new Set(initialSessions.map((s) => s.exitIp)).size;

    const run: RunRecord = {
      id: runId,
      config: {
        mode: config.mode,
        targetUrl: config.targetUrl,
        searchQuery: config.searchQuery,
        username: config.username,
        clues: config.clues,
        hasReferenceImage: Boolean(config.referenceImageDataUrl),
        desiredSessionCount: desiredCount,
        maxSearchPages: Math.max(1, Math.min(5, config.maxSearchPages ?? 3)),
        minWatchSeconds: targetWatchSeconds,
        autoEnrichQuery: config.autoEnrichQuery !== false,
        enableProfileWarmup: config.enableProfileWarmup !== false,
        humanizeWatchCurve: config.humanizeWatchCurve !== false,
        enableSessionDepth: config.enableSessionDepth !== false,
        strictExactClickOnly: config.strictExactClickOnly,
        captureProofScreenshot: config.captureProofScreenshot,
        allowDirectSessionFallback: config.allowDirectSessionFallback,
        autoDismissCookies: config.autoDismissCookies,
        autoClickActionButton: config.autoClickActionButton,
        actionButtonSelector: config.actionButtonSelector,
      },
      resolvedTargetTitle: null,
      resolvedTargetAuthor: null,
      status: 'running',
      createdAt: new Date().toISOString(),
      finishedAt: null,
      totalSessionsPlanned: initialSessions.length,
      uniqueIpsUsed,
      matchedSessionsCount: 0,
      skippedCandidatesCount: 0,
      sessions: initialSessions,
      osintHits: [],
    };

    this.runs.set(runId, run);
    this.saveToDisk();
    eventBus.broadcast({ type: 'run-updated', payload: run });

    // Launch async execution in background
    this.executeRunInBackground(run, assignedProxies, config, abortController.signal).catch(
      (err) => {
        run.status = 'failed';
        run.summaryError = err instanceof Error ? err.message : 'Bilinmeyen yürütme hatası';
        run.finishedAt = new Date().toISOString();
        this.saveToDisk();
        eventBus.broadcast({ type: 'run-updated', payload: run });
      }
    );

    return run;
  }

  private async executeRunInBackground(
    run: RunRecord,
    assignedProxies: Array<ProxyEndpoint | null>,
    config: RunConfig,
    signal: AbortSignal
  ): Promise<void> {
    const targetWatchSeconds = clampMinWatchSeconds(config.minWatchSeconds, 60);
    const updateSessionState = (updated: SessionExecution) => {
      const idx = run.sessions.findIndex((s) => s.sessionId === updated.sessionId);
      if (idx >= 0) {
        run.sessions[idx] = updated;
      }
      run.matchedSessionsCount = run.sessions.filter((s) => s.status === 'matched').length;
      run.skippedCandidatesCount = run.sessions.reduce((acc, s) => acc + s.candidatesSkipped, 0);
      eventBus.broadcast({
        type: 'session-updated',
        payload: { runId: run.id, session: updated },
      });
    };

    const usedExitIps = new Set<string>(
      assignedProxies.map((p) => p?.exitIp).filter((ip): ip is string => Boolean(ip))
    );
    const failedProxyIds = new Set<string>();

    const runWithFailover = async (
      initialSess: SessionExecution,
      initialProxy: ProxyEndpoint | null,
      executor: (
        sess: SessionExecution,
        proxy: ProxyEndpoint | null,
        attemptSignal: AbortSignal
      ) => Promise<SessionExecution>
    ): Promise<void> => {
      let currentSess = initialSess;
      let currentProxy = initialProxy;
      const maxRetries = 2;

      const attemptTimeoutMs = 165000 + targetWatchSeconds * 1000;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let timer: NodeJS.Timeout | null = null;
        let res: SessionExecution;
        const attemptAbort = new AbortController();
        const onParentAbort = () => attemptAbort.abort();
        signal.addEventListener('abort', onParentAbort, { once: true });
        try {
          res = await Promise.race([
            executor(currentSess, currentProxy, attemptAbort.signal),
            new Promise<SessionExecution>((resolve) => {
              timer = setTimeout(() => {
                attemptAbort.abort();
                resolve({
                  ...currentSess,
                  status: 'proxy-error',
                  error: 'Oturum zaman aşımı (proxy yanıt vermedi)',
                  updatedAt: new Date().toISOString(),
                });
              }, attemptTimeoutMs);
            }),
          ]);
        } catch (err) {
          res = {
            ...currentSess,
            status: 'proxy-error',
            error: err instanceof Error ? err.message : 'Beklenmeyen oturum hatası',
            updatedAt: new Date().toISOString(),
          };
          updateSessionState(res);
        } finally {
          if (timer) clearTimeout(timer);
          signal.removeEventListener('abort', onParentAbort);
        }

        const isProxyFailure =
          res.status === 'proxy-error' && isRetryableProxyErrorMessage(res.error || '');
        const isBlockGate = isQuarantineWorthyBlock(res.httpStatus, res.trafficStatus);

        if ((isProxyFailure || isBlockGate) && currentProxy && !signal.aborted) {
          failedProxyIds.add(currentProxy.id);
          proxyPool.markProxyFailed(
            currentProxy.id,
            isBlockGate
              ? res.trafficGateReason || `HTTP ${res.httpStatus ?? 403} bot/WAF engeli`
              : res.error || 'Oturum proxy hatası'
          );

          if (attempt < maxRetries) {
            const backup = proxyPool.acquireHealthyReserveProxy(usedExitIps, failedProxyIds);
            if (backup && backup.exitIp) {
              usedExitIps.add(backup.exitIp);
              currentProxy = backup;
              const nextFp = pickFingerprint(`${backup.id}-retry-${attempt + 1}`, backup.countryCode, {
                timezone: backup.timezone,
                lat: backup.lat,
                lon: backup.lon,
              });
              currentSess = {
                ...currentSess,
                proxyId: backup.id,
                proxyAddress: `${backup.host}:${backup.port}`,
                protocol: backup.protocol,
                exitIp: backup.exitIp,
                country: backup.country || 'Bilinmiyor',
                countryCode: backup.countryCode ?? null,
                networkType: backup.networkType || 'unknown',
                userAgent: nextFp.userAgent,
                locale: nextFp.locale,
                timezoneId: nextFp.timezoneId,
                osPlatform: `${nextFp.uaPlatform} (${nextFp.platform})`,
                webglRenderer: nextFp.webglRenderer,
                screenResolution: `${nextFp.screen.width}x${nextFp.screen.height}`,
                consistencyScore: nextFp.consistencyScore,
                cdpHardened: true,
                tlsProfile: nextFp.tlsProfile,
                behaviorMode: config.humanizeWatchCurve !== false ? 'bezier-human' : 'standard',
                failoverCount: (currentSess.failoverCount ?? 0) + 1,
                status: 'queued',
                trafficStatus: 'unknown',
                trafficGateReason: null,
                error: null,
                candidatesInspected: 0,
                candidatesSkipped: 0,
                watchSecondsActual: 0,
                targetWatchSeconds,
                videoDurationSeconds: null,
                playbackStatus: 'idle',
                profileState: 'cold',
                watchtimePingCount: 0,
                lastWatchtimePingStatus: null,
                sessionDepthUrl: null,
                sessionDepthTitle: null,
                decisions: [],
                updatedAt: new Date().toISOString(),
              };
              run.uniqueIpsUsed = new Set(
                run.sessions.map((s) => (s.sessionId === currentSess.sessionId ? backup.exitIp! : s.exitIp))
              ).size;
              updateSessionState(currentSess);
              continue;
            }
          }
        }
        break;
      }
    };

    if (config.mode === 'exact-link') {
      let targetMetadata: TargetMetadataHint | undefined;
      if (config.autoEnrichQuery !== false) {
        targetMetadata = await fetchTargetMetadata(config.targetUrl);
        if (targetMetadata.title || targetMetadata.author) {
          run.resolvedTargetTitle = targetMetadata.title ?? null;
          run.resolvedTargetAuthor = targetMetadata.author ?? null;
          this.saveToDisk();
          eventBus.broadcast({ type: 'run-updated', payload: run });
        }
      }

      const concurrency = 8;
      let cursor = 0;
      const workers = Array.from({ length: Math.min(concurrency, run.sessions.length) }, async () => {
        while (!signal.aborted && cursor < run.sessions.length) {
          const i = cursor++;
          const sess = run.sessions[i];
          const proxy = assignedProxies[i] ?? null;
          await runWithFailover(sess, proxy, (s, p, attemptSignal) =>
            runExactLinkSession({
              runId: run.id,
              session: s,
              proxy: p,
              config,
              targetMetadata,
              signal: attemptSignal,
              onUpdate: updateSessionState,
            })
          );
        }
      });
      await Promise.all(workers);
    } else {
      // OSINT username + image + clues across distinct IP sessions
      const referenceDHash = config.referenceImageDataUrl
        ? await computeImageDHash(config.referenceImageDataUrl)
        : null;

      // Also check DuckDuckGo web search across remaining sessions in addition to 10 core platforms
      const concurrency = 8;
      let cursor = 0;
      const workers = Array.from({ length: Math.min(concurrency, run.sessions.length) }, async () => {
        while (!signal.aborted && cursor < run.sessions.length) {
          const i = cursor++;
          const sess = run.sessions[i];
          const proxy = assignedProxies[i] ?? null;

          if (i < 10) {
            await runWithFailover(sess, proxy, (s, p) =>
              runOsintPlatformCheck({
                runId: run.id,
                platformIndex: i,
                session: s,
                proxy: p,
                config,
                referenceDHash,
                onUpdateSession: updateSessionState,
                onOsintHit: (hit: ProfileDiscoveryHit) => {
                  run.osintHits.push(hit);
                  eventBus.broadcast({
                    type: 'osint-hit',
                    payload: { runId: run.id, hit },
                  });
                },
              })
            );
          } else {
            // Remaining distinct-IP sessions perform multi-query web discovery via DuckDuckGo
            const webQuery = `${config.username} ${config.clues}`.trim();
            await runWithFailover(sess, proxy, (s, p, attemptSignal) =>
              runExactLinkSession({
                runId: run.id,
                session: s,
                proxy: p,
                config: {
                  ...config,
                  mode: 'exact-link',
                  targetUrl: config.targetUrl || `https://github.com/${config.username.replace(/^@/, '')}`,
                  searchQuery: webQuery,
                },
                signal: attemptSignal,
                onUpdate: updateSessionState,
              })
            );
          }
        }
      });
      await Promise.all(workers);
    }

    if (!signal.aborted) {
      run.status = 'completed';
    }
    run.finishedAt = new Date().toISOString();
    run.matchedSessionsCount = run.sessions.filter((s) => s.status === 'matched').length;
    run.skippedCandidatesCount = run.sessions.reduce((acc, s) => acc + s.candidatesSkipped, 0);
    this.abortControllers.delete(run.id);
    this.saveToDisk();
    eventBus.broadcast({ type: 'run-updated', payload: run });
  }
}

export const orchestrator = new RunOrchestrator();
