/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { MobileMenuButton, Sidebar, type ActiveTab } from './components/Sidebar';
import { TargetOrchestratorView } from './components/TargetOrchestratorView';
import { ProxyPoolView } from './components/ProxyPoolView';
import { RunHistoryView } from './components/RunHistoryView';
import { SessionDetailModal } from './components/SessionDetailModal';
import type {
  HarvestProgress,
  ProxyEndpoint,
  ProxyProtocol,
  RunConfig,
  RunRecord,
  SessionExecution,
  SSEMessage,
} from './types/automation';

const DEFAULT_PROGRESS: HarvestProgress = {
  running: false,
  phase: 'idle',
  fetchedCount: 0,
  probedCount: 0,
  verifiedUniqueCount: 0,
  targetUniqueCount: 45,
  currentFeed: '',
  startedAt: null,
  finishedAt: null,
};

async function readJsonSafely<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('orchestrator');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [proxies, setProxies] = useState<ProxyEndpoint[]>([]);
  const [verifiedUniqueCount, setVerifiedUniqueCount] = useState(0);
  const [warmProfilesCount, setWarmProfilesCount] = useState(0);
  const [harvestProgress, setHarvestProgress] = useState<HarvestProgress>(DEFAULT_PROGRESS);

  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionExecution | null>(null);

  const inFlightProxiesRef = useRef(false);
  const inFlightRunsRef = useRef(false);

  const fetchProxies = useCallback(async (retryOnTransientError = false): Promise<void> => {
    if (inFlightProxiesRef.current) return;
    inFlightProxiesRef.current = true;
    try {
      const res = await fetch('/api/proxies');
      if (!res.ok) return;
      const data = await readJsonSafely<{
        progress: HarvestProgress;
        verifiedUniqueCount: number;
        warmProfilesCount?: number;
        proxies: ProxyEndpoint[];
      }>(res);
      if (!data) return;
      setProxies(data.proxies);
      setVerifiedUniqueCount(data.verifiedUniqueCount);
      if (typeof data.warmProfilesCount === 'number') {
        setWarmProfilesCount(data.warmProfilesCount);
      }
      setHarvestProgress(data.progress);
    } catch {
      if (retryOnTransientError) {
        inFlightProxiesRef.current = false;
        await new Promise((r) => setTimeout(r, 1200));
        await fetchProxies(false);
        return;
      }
      // Transient connection drop / server restart; SSE and polling recover automatically
    } finally {
      inFlightProxiesRef.current = false;
    }
  }, []);

  const fetchRuns = useCallback(async (retryOnTransientError = false): Promise<void> => {
    if (inFlightRunsRef.current) return;
    inFlightRunsRef.current = true;
    try {
      const res = await fetch('/api/runs');
      if (!res.ok) return;
      const data = await readJsonSafely<{ runs: RunRecord[] }>(res);
      if (!data) return;
      setRuns(data.runs);
      setActiveRunId((prev) => prev ?? data.runs[0]?.id ?? null);
    } catch {
      if (retryOnTransientError) {
        inFlightRunsRef.current = false;
        await new Promise((r) => setTimeout(r, 1200));
        await fetchRuns(false);
        return;
      }
      // Transient connection drop / server restart; SSE and polling recover automatically
    } finally {
      inFlightRunsRef.current = false;
    }
  }, []);

  useEffect(() => {
    void fetchProxies(true);
    void fetchRuns(true);
  }, [fetchProxies, fetchRuns]);

  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as SSEMessage;
        if (msg.type === 'harvest-progress') {
          setHarvestProgress(msg.payload);
          setVerifiedUniqueCount(msg.payload.verifiedUniqueCount);
          if (!msg.payload.running && msg.payload.phase === 'completed') {
            void fetchProxies();
          }
        } else if (msg.type === 'proxy-verified') {
          setProxies((prev) => {
            const idx = prev.findIndex((p) => p.id === msg.payload.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = msg.payload;
              return next;
            }
            return [msg.payload, ...prev];
          });
        } else if (msg.type === 'run-updated') {
          setRuns((prev) => {
            const idx = prev.findIndex((r) => r.id === msg.payload.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = msg.payload;
              return next;
            }
            return [msg.payload, ...prev];
          });
          if (msg.payload.status !== 'running') {
            void fetchProxies();
          }
        } else if (msg.type === 'session-updated') {
          const { runId, session } = msg.payload;
          setRuns((prev) =>
            prev.map((run) => {
              if (run.id !== runId) return run;
              const nextSessions = run.sessions.map((s) =>
                s.sessionId === session.sessionId ? session : s
              );
              return {
                ...run,
                sessions: nextSessions,
                matchedSessionsCount: nextSessions.filter((s) => s.status === 'matched').length,
                skippedCandidatesCount: nextSessions.reduce(
                  (acc, s) => acc + s.candidatesSkipped,
                  0
                ),
              };
            })
          );
          setSelectedSession((curr) =>
            curr && curr.sessionId === session.sessionId ? session : curr
          );
        } else if (msg.type === 'osint-hit') {
          const { runId, hit } = msg.payload;
          setRuns((prev) =>
            prev.map((run) => {
              if (run.id !== runId) return run;
              return {
                ...run,
                osintHits: [...run.osintHits, hit],
              };
            })
          );
        }
      } catch {
        // Ignore malformed SSE frames
      }
    };

    return () => {
      es.close();
    };
  }, [fetchProxies]);

  const activeRunStatus = runs.find((r) => r.id === activeRunId)?.status ?? runs[0]?.status;

  useEffect(() => {
    if (activeRunStatus !== 'running' && !harvestProgress.running) return;
    const timer = setInterval(() => {
      if (activeRunStatus === 'running') {
        void fetchRuns();
      }
      if (harvestProgress.running) {
        void fetchProxies();
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [activeRunStatus, harvestProgress.running, fetchRuns, fetchProxies]);

  const handleStartHarvest = async (targetCount: number) => {
    try {
      const res = await fetch('/api/proxies/harvest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUniqueCount: targetCount }),
      });
      if (!res.ok) return;
      const data = await readJsonSafely<{ progress: HarvestProgress }>(res);
      if (data?.progress) {
        setHarvestProgress(data.progress);
      }
    } catch {
      // Ignore transient network failure on harvest trigger
    }
  };

  const handleStopHarvest = async () => {
    try {
      await fetch('/api/proxies/stop', { method: 'POST' });
    } catch {
      // Ignore transient network failure
    }
    await fetchProxies();
  };

  const handleReverifyProxies = async () => {
    try {
      const res = await fetch('/api/proxies/reverify', { method: 'POST' });
      if (res.ok) {
        const data = await readJsonSafely<{ progress: HarvestProgress }>(res);
        if (data?.progress) {
          setHarvestProgress(data.progress);
        }
      }
    } catch {
      // Ignore transient network failure
    }
  };

  const handleImportProxies = async (rawText: string, defaultProtocol: ProxyProtocol) => {
    let res: Response;
    try {
      res = await fetch('/api/proxies/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText, defaultProtocol }),
      });
    } catch {
      throw new Error('Sunucuya bağlanılamadı. Lütfen birkaç saniye sonra tekrar deneyin.');
    }
    const data = await readJsonSafely<{
      error?: string;
      proxies?: ProxyEndpoint[];
      verifiedUniqueCount?: number;
      parsedCount?: number;
      verifiedCount?: number;
    }>(res);
    if (!res.ok || !data) {
      throw new Error(data?.error || 'Proxy içe aktarım hatası.');
    }
    setProxies(data.proxies ?? []);
    setVerifiedUniqueCount(data.verifiedUniqueCount ?? 0);
    return { parsedCount: data.parsedCount ?? 0, verifiedCount: data.verifiedCount ?? 0 };
  };

  const handleClearProxies = async () => {
    try {
      const res = await fetch('/api/proxies', { method: 'DELETE' });
      if (!res.ok) return;
      setProxies([]);
      setVerifiedUniqueCount(0);
      setHarvestProgress(DEFAULT_PROGRESS);
    } catch {
      // Ignore transient network failure
    }
  };

  const handleStartRun = async (config: RunConfig) => {
    let res: Response;
    try {
      res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
    } catch {
      throw new Error('Sunucuya bağlanılamadı. Lütfen birkaç saniye sonra tekrar deneyin.');
    }
    const data = await readJsonSafely<{ error?: string; run?: RunRecord }>(res);
    if (!res.ok || !data?.run) {
      throw new Error(data?.error || 'Görev başlatılamadı.');
    }
    const created = data.run;
    setRuns((prev) => [created, ...prev.filter((r) => r.id !== created.id)]);
    setActiveRunId(created.id);
  };

  const handleStopRun = async (runId: string) => {
    try {
      await fetch(`/api/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' });
    } catch {
      // Ignore transient network failure
    }
    await fetchRuns();
  };

  const activeRun = runs.find((r) => r.id === activeRunId) ?? runs[0] ?? null;

  const pageTitle =
    activeTab === 'orchestrator'
      ? 'Görev Orkestratörü'
      : activeTab === 'proxies'
      ? 'IP & Oturum Havuzu'
      : 'Doğrulama Geçmişi';

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        verifiedUniqueCount={verifiedUniqueCount}
        targetIpCount={30}
        harvestRunning={harvestProgress.running}
        runsCount={runs.length}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <MobileMenuButton onClick={() => setMobileMenuOpen(true)} />
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 hidden sm:inline whitespace-nowrap">NexusIP</span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">/</span>
              <h1 className="font-display font-semibold text-slate-900 truncate">{pageTitle}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden md:inline font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
              {verifiedUniqueCount} doğrulanmış benzersiz IP
            </span>
            <button
              type="button"
              onClick={() => {
                setActiveTab('proxies');
                if (!harvestProgress.running) {
                  handleStartHarvest(45).catch(() => undefined);
                }
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${harvestProgress.running ? 'animate-spin' : ''}`} />
              <span>{harvestProgress.running ? 'IP Taranıyor' : '30+ IP Hazırla'}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1280px] w-full mx-auto">
          {activeTab === 'orchestrator' && (
            <TargetOrchestratorView
              verifiedUniqueCount={verifiedUniqueCount}
              warmProfilesCount={warmProfilesCount}
              activeRun={activeRun}
              onStartRun={handleStartRun}
              onStopRun={handleStopRun}
              onOpenProxyTab={() => setActiveTab('proxies')}
              onSelectSession={setSelectedSession}
            />
          )}

          {activeTab === 'proxies' && (
            <ProxyPoolView
              proxies={proxies}
              progress={harvestProgress}
              verifiedUniqueCount={verifiedUniqueCount}
              warmProfilesCount={warmProfilesCount}
              onStartHarvest={handleStartHarvest}
              onStopHarvest={handleStopHarvest}
              onReverifyProxies={handleReverifyProxies}
              onImportProxies={handleImportProxies}
              onClearProxies={handleClearProxies}
            />
          )}

          {activeTab === 'history' && (
            <RunHistoryView
              runs={runs}
              onInspectRun={(run) => {
                setActiveRunId(run.id);
                setActiveTab('orchestrator');
              }}
            />
          )}
        </main>
      </div>

      <SessionDetailModal
        session={selectedSession}
        onClose={() => setSelectedSession(null)}
      />
    </div>
  );
}
