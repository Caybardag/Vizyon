import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  Loader2,
  Play,
  ShieldAlert,
  Square,
  Upload,
  UserSearch,
  X,
  XCircle,
} from 'lucide-react';
import type {
  RunConfig,
  RunRecord,
  SessionExecution,
  TargetMode,
} from '../types/automation';
import { extractYouTubeVideoId, formatClockSeconds, normalizeTargetUrl } from '../lib/targetMatcher';

interface TargetOrchestratorViewProps {
  verifiedUniqueCount: number;
  warmProfilesCount: number;
  activeRun: RunRecord | null;
  onStartRun: (config: RunConfig) => Promise<void>;
  onStopRun: (runId: string) => Promise<void>;
  onOpenProxyTab: () => void;
  onSelectSession: (session: SessionExecution) => void;
}

export function TargetOrchestratorView({
  verifiedUniqueCount,
  warmProfilesCount,
  activeRun,
  onStartRun,
  onStopRun,
  onOpenProxyTab,
  onSelectSession,
}: TargetOrchestratorViewProps) {
  const [mode, setMode] = useState<TargetMode>('exact-link');
  const [targetUrl, setTargetUrl] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [username, setUsername] = useState('');
  const [clues, setClues] = useState('');
  const [referenceImageDataUrl, setReferenceImageDataUrl] = useState<string | null>(null);
  const [referenceImageName, setReferenceImageName] = useState<string | null>(null);

  const [desiredSessionCount, setDesiredSessionCount] = useState(30);
  const [maxSearchPages, setMaxSearchPages] = useState(3);
  const [minWatchSeconds, setMinWatchSeconds] = useState(60);
  const [autoEnrichQuery, setAutoEnrichQuery] = useState(true);
  const [enableProfileWarmup, setEnableProfileWarmup] = useState(true);
  const [humanizeWatchCurve, setHumanizeWatchCurve] = useState(true);
  const [enableSessionDepth, setEnableSessionDepth] = useState(true);
  const [captureProofScreenshot, setCaptureProofScreenshot] = useState(true);
  const [allowDirectSessionFallback, setAllowDirectSessionFallback] = useState(false);
  const [autoDismissCookies, setAutoDismissCookies] = useState(true);
  const [autoClickActionButton, setAutoClickActionButton] = useState(true);
  const [actionButtonSelector, setActionButtonSelector] = useState('');

  const [targetPreview, setTargetPreview] = useState<{ title: string | null; author: string | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const trimmed = targetUrl.trim();
    if (mode !== 'exact-link' || !trimmed || !trimmed.startsWith('http')) {
      setTargetPreview(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/target-preview?url=${encodeURIComponent(trimmed)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { title: string | null; author: string | null };
        if (data.title || data.author) {
          setTargetPreview(data);
        } else {
          setTargetPreview(null);
        }
      } catch {
        setTargetPreview(null);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [targetUrl, mode]);

  const targetAnalysis = useMemo(() => {
    if (!targetUrl.trim()) return null;
    const ytId = extractYouTubeVideoId(targetUrl);
    const watchNote =
      minWatchSeconds > 0
        ? ` Eşleşen video en az ${minWatchSeconds} saniye boyunca gerçek oynatıcıda izletilir.`
        : '';
    if (ytId) {
      return {
        type: 'YouTube Video ID',
        canonical: `https://www.youtube.com/watch?v=${ytId}`,
        rule: `Sadece Video ID "${ytId}" ile birebir eşleşen sonuç tıklanır; ilk ${maxSearchPages} sayfada (~${maxSearchPages * 25} sonuç) taranır, diğer tüm videolar atlanır.${watchNote}`,
      };
    }
    return {
      type: 'Kanonik Web URL',
      canonical: normalizeTargetUrl(targetUrl),
      rule: `Sadece normalize edilmiş hedef URL ile birebir eşleşen bağlantı ilk ${maxSearchPages} sayfada aranıp açılır.${watchNote}`,
    };
  }, [targetUrl, maxSearchPages, minWatchSeconds]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setFormError('Referans görsel boyutu en fazla 4 MB olmalıdır.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setReferenceImageDataUrl(reader.result);
        setReferenceImageName(file.name);
        setFormError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (mode === 'exact-link' && !targetUrl.trim()) {
      setFormError('Lütfen ulaşılacak hedef video veya web bağlantısını girin.');
      return;
    }
    if (mode === 'identity-osint' && !username.trim()) {
      setFormError('Lütfen aranacak kullanıcı adını girin.');
      return;
    }

    setSubmitting(true);
    try {
      await onStartRun({
        mode,
        targetUrl: targetUrl.trim(),
        searchQuery: searchQuery.trim(),
        username: username.trim(),
        clues: clues.trim(),
        referenceImageDataUrl,
        desiredSessionCount,
        maxSearchPages,
        minWatchSeconds: mode === 'exact-link' ? minWatchSeconds : 0,
        autoEnrichQuery,
        enableProfileWarmup,
        humanizeWatchCurve,
        enableSessionDepth,
        strictExactClickOnly: true,
        captureProofScreenshot,
        allowDirectSessionFallback,
        autoDismissCookies,
        autoClickActionButton,
        actionButtonSelector: actionButtonSelector.trim(),
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Görev başlatılamadı.');
    } finally {
      setSubmitting(false);
    }
  };

  const discoverabilityStats = useMemo(() => {
    if (!activeRun) return null;
    const matched = activeRun.sessions.filter((s) => s.status === 'matched');
    const ranked = matched.filter((s) => typeof s.foundAtRank === 'number' && s.foundAtRank !== null);
    const bestRank = ranked.length > 0 ? Math.min(...ranked.map((s) => s.foundAtRank as number)) : null;
    const bestPage =
      ranked.length > 0
        ? ranked.find((s) => s.foundAtRank === bestRank)?.foundAtPage ?? null
        : null;
    const avgRank =
      ranked.length > 0
        ? Math.round(ranked.reduce((sum, s) => sum + (s.foundAtRank as number), 0) / ranked.length)
        : null;

    const queryCounts = new Map<string, number>();
    for (const s of matched) {
      if (s.matchedQuery) {
        queryCounts.set(s.matchedQuery, (queryCounts.get(s.matchedQuery) ?? 0) + 1);
      }
    }
    const topQuery =
      Array.from(queryCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const ispMatched = matched.filter((s) => s.networkType === 'residential-isp').length;
    const dcMatched = matched.filter((s) => s.networkType === 'datacenter').length;
    const botGates = activeRun.sessions.filter((s) => s.trafficStatus === 'bot-gate-detected').length;

    const watchSessions = activeRun.sessions.filter(
      (s) => typeof s.watchSecondsActual === 'number' && s.watchSecondsActual > 0
    );
    const watchedTargetCount = matched.filter((s) => {
      const target = s.targetWatchSeconds ?? activeRun.config.minWatchSeconds ?? 0;
      if (target <= 0) return false;
      return s.playbackStatus === 'completed' || (s.watchSecondsActual ?? 0) >= target;
    }).length;
    const avgWatchSeconds =
      watchSessions.length > 0
        ? Math.round(
            watchSessions.reduce((sum, s) => sum + (s.watchSecondsActual ?? 0), 0) /
              watchSessions.length
          )
        : 0;

    const watchtimePingSessions = matched.filter(
      (s) => typeof s.watchtimePingCount === 'number' && s.watchtimePingCount > 0
    ).length;
    const totalWatchtimePings = activeRun.sessions.reduce(
      (sum, s) => sum + (s.watchtimePingCount ?? 0),
      0
    );

    const scoredSessions = activeRun.sessions.filter(
      (s) => typeof s.consistencyScore === 'number'
    );
    const avgConsistency =
      scoredSessions.length > 0
        ? Math.round(
            scoredSessions.reduce((sum, s) => sum + (s.consistencyScore ?? 100), 0) /
              scoredSessions.length
          )
        : 100;
    const totalFailovers = activeRun.sessions.reduce(
      (sum, s) => sum + (s.failoverCount ?? 0),
      0
    );

    return {
      bestRank,
      bestPage,
      avgRank,
      topQuery,
      ispMatched,
      dcMatched,
      botGates,
      watchedTargetCount,
      avgWatchSeconds,
      watchtimePingSessions,
      totalWatchtimePings,
      avgConsistency,
      totalFailovers,
    };
  }, [activeRun]);

  const isRunning = activeRun?.status === 'running';
  const needsMoreProxies = !allowDirectSessionFallback && verifiedUniqueCount < desiredSessionCount;

  const renderSessionStatus = (sess: SessionExecution) => {
    switch (sess.status) {
      case 'matched':
        if (sess.trafficStatus === 'bot-gate-detected' || sess.playbackStatus === 'blocked') {
          return (
            <span className="inline-flex items-center gap-1.5 text-amber-700 font-medium">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
              <span>Bot / CAPTCHA Engeli</span>
            </span>
          );
        }
        if ((sess.targetWatchSeconds ?? 0) > 0 && sess.playbackStatus === 'stalled') {
          return (
            <span className="inline-flex items-center gap-1.5 text-amber-700 font-medium">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Akış Durakladı</span>
            </span>
          );
        }
        if ((sess.targetWatchSeconds ?? 0) > 0 && sess.playbackStatus === 'no-video') {
          return (
            <span className="inline-flex items-center gap-1.5 text-amber-700 font-medium">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Oynatıcı Yüklenemedi</span>
            </span>
          );
        }
        return (
          <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>
              {(sess.targetWatchSeconds ?? 0) > 0 && sess.playbackStatus === 'completed'
                ? 'Hedef İzlendi'
                : 'Hedef Tıklandı'}
            </span>
          </span>
        );
      case 'watching': {
        const target = sess.targetWatchSeconds ?? minWatchSeconds;
        const watched = Math.round(sess.watchSecondsActual ?? 0);
        return (
          <span className="inline-flex items-center gap-1.5 text-blue-700 font-medium tabular-nums">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span>{`İzleniyor (${watched}/${target} sn)`}</span>
          </span>
        );
      }
      case 'searching':
      case 'initializing':
      case 'navigating-match':
        return (
          <span className="inline-flex items-center gap-1.5 text-blue-700 font-medium">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span>
              {sess.status === 'initializing'
                ? 'Oturum Başlıyor'
                : sess.status === 'searching'
                ? 'Aranıyor'
                : 'Hedef Açılıyor'}
            </span>
          </span>
        );
      case 'not-found':
        return (
          <span className="inline-flex items-center gap-1.5 text-amber-700 font-medium">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>Bulunamadı (Atlandı)</span>
          </span>
        );
      case 'proxy-error':
        return (
          <span className="inline-flex items-center gap-1.5 text-red-700 font-medium">
            <XCircle className="w-3.5 h-3.5 shrink-0" />
            <span>Proxy Hatası</span>
          </span>
        );
      default:
        return <span className="text-slate-500">Sırada</span>;
    }
  };

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-900">
                Hedef Odaklı Çoklu Oturum Yapılandırması
              </h2>
              <p className="text-sm text-slate-600 mt-0.5">
                Her oturum izole tarayıcı bağlamı ve farklı doğrulanmış IP ile arama yapar; sadece birebir hedef eşleşince açar.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-full md:w-auto shrink-0">
              <button
                type="button"
                onClick={() => setMode('exact-link')}
                className={`inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap min-w-0 ${
                  mode === 'exact-link'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Link2 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Hedef Bağlantı / YouTube</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('identity-osint')}
                className={`inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap min-w-0 ${
                  mode === 'identity-osint'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <UserSearch className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Kullanıcı Adı &amp; Görsel</span>
              </button>
            </div>
          </div>

          {mode === 'exact-link' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="target-url-input" className="block text-sm font-medium text-slate-900">
                  Hedef Bağlantı (YouTube Video veya Web URL)
                </label>
                <input
                  id="target-url-input"
                  type="url"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="search-query-input" className="block text-sm font-medium text-slate-900">
                  Arama Sorgusu / Anahtar Kelimeler (İsteğe bağlı)
                </label>
                <input
                  id="search-query-input"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Video başlığı, kanal adı veya arama terimi"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              {targetAnalysis && (
                <div className="lg:col-span-2 p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-slate-700 font-medium">
                    <span>Sıkı Eşleşme Kuralı: {targetAnalysis.type}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-slate-900">{targetAnalysis.canonical}</span>
                    {targetPreview?.title && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-slate-900 font-semibold">
                          {targetPreview.title}
                          {targetPreview.author ? ` (${targetPreview.author})` : ''}
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-slate-600">{targetAnalysis.rule}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-4 space-y-1.5">
                <label htmlFor="username-input" className="block text-sm font-medium text-slate-900">
                  Kullanıcı Adı / Handle
                </label>
                <input
                  id="username-input"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="örn. torvalds"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="lg:col-span-4 space-y-1.5">
                <label htmlFor="clues-input" className="block text-sm font-medium text-slate-900">
                  Diğer Detaylar / İpuçları (virgülle ayırın)
                </label>
                <input
                  id="clues-input"
                  type="text"
                  value={clues}
                  onChange={(e) => setClues(e.target.value)}
                  placeholder="örn. Linux, Portland, developer"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="lg:col-span-4 space-y-1.5">
                <span className="block text-sm font-medium text-slate-900">
                  Referans Görsel (Algısal dHash Eşleştirme)
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="hidden"
                />
                {referenceImageDataUrl ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-slate-50">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <img
                        src={referenceImageDataUrl}
                        alt="Yüklenen referans görsel"
                        className="w-8 h-8 rounded object-cover border border-slate-200 shrink-0"
                      />
                      <span className="text-xs text-slate-700 truncate">{referenceImageName}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setReferenceImageDataUrl(null);
                        setReferenceImageName(null);
                      }}
                      aria-label="Referans görseli kaldır"
                      className="p-1 text-slate-500 hover:text-slate-900"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg border border-dashed border-slate-300 text-sm text-slate-600 hover:border-slate-400 hover:text-slate-900"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Görsel Yükle (PNG/JPG/WebP)</span>
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pt-4 border-t border-slate-200">
            <div className="flex flex-wrap items-center gap-5 text-xs text-slate-700">
              <label className="flex items-center gap-2 font-medium">
                <span>Oturum / Farklı IP Sayısı:</span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={desiredSessionCount}
                  onChange={(e) => setDesiredSessionCount(Math.max(1, Math.min(60, Number(e.target.value) || 30)))}
                  className="w-16 px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono text-sm text-slate-900 tabular-nums"
                />
              </label>

              {mode === 'exact-link' && (
                <>
                  <label className="flex items-center gap-2 font-medium">
                    <span>Arama Derinliği:</span>
                    <select
                      value={maxSearchPages}
                      onChange={(e) => setMaxSearchPages(Number(e.target.value))}
                      aria-label="Maksimum arama sayfası derinliği"
                      className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-mono text-xs text-slate-900"
                    >
                      <option value={1}>1 Sayfa (~25 sonuç)</option>
                      <option value={2}>2 Sayfa (~50 sonuç)</option>
                      <option value={3}>3 Sayfa (~75 sonuç)</option>
                      <option value={4}>4 Sayfa (~100 sonuç)</option>
                      <option value={5}>5 Sayfa (~120 sonuç)</option>
                    </select>
                  </label>

                  <label className="flex items-center gap-2 font-medium">
                    <span>İzleme Süresi:</span>
                    <select
                      value={minWatchSeconds}
                      onChange={(e) => setMinWatchSeconds(Number(e.target.value))}
                      aria-label="Minimum video izleme süresi"
                      className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-mono text-xs text-slate-900"
                    >
                      <option value={0}>0 sn (Sadece Tıkla)</option>
                      <option value={30}>30 sn</option>
                      <option value={60}>60 sn (En az 1 dk)</option>
                      <option value={90}>90 sn</option>
                      <option value={120}>120 sn (2 dk)</option>
                      <option value={180}>180 sn (3 dk)</option>
                    </select>
                  </label>
                </>
              )}

              {mode === 'exact-link' && (
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoEnrichQuery}
                    onChange={(e) => setAutoEnrichQuery(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  />
                  <span>Hedef başlık ve kanalla sorguyu zenginleştir</span>
                </label>
              )}

              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={captureProofScreenshot}
                  onChange={(e) => setCaptureProofScreenshot(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>Hedefe ulaşınca ekran görüntüsü kanıtı al</span>
              </label>

              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoDismissCookies}
                  onChange={(e) => setAutoDismissCookies(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>Çerez / GDPR penceresini otomatik geç</span>
              </label>

              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoClickActionButton}
                  onChange={(e) => setAutoClickActionButton(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>Trafik kontrolü &amp; hedef sayfa butonuna otomatik bas</span>
              </label>

              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableProfileWarmup}
                  onChange={(e) => setEnableProfileWarmup(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>Profil ısıtma &amp; kalıcı çerez havuzu ({warmProfilesCount} hazır)</span>
              </label>

              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={humanizeWatchCurve}
                  onChange={(e) => setHumanizeWatchCurve(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>İnsan benzeri izleme eğrisi (+değişken süre, kaydırma, ses)</span>
              </label>

              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableSessionDepth}
                  onChange={(e) => setEnableSessionDepth(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>Oturum derinliği (izleme sonrası önerilen videoya geçiş)</span>
              </label>

              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowDirectSessionFallback}
                  onChange={(e) => setAllowDirectSessionFallback(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>Proxy 30&apos;dan azsa mevcut havuz / yerel oturumla çalıştır</span>
              </label>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {isRunning && activeRun ? (
                <button
                  type="button"
                  onClick={() => onStopRun(activeRun.id)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 whitespace-nowrap"
                >
                  <Square className="w-4 h-4" />
                  <span>Görevi Durdur</span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                  <span>{desiredSessionCount} İzole Oturumu Başlat</span>
                </button>
              )}
            </div>
          </div>

          {autoClickActionButton && (
            <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <label htmlFor="action-button-selector" className="text-xs font-medium text-slate-700 sm:whitespace-nowrap">
                Otomatik Basılacak Buton (İsteğe bağlı metin / CSS seçici):
              </label>
              <input
                id="action-button-selector"
                type="text"
                value={actionButtonSelector}
                onChange={(e) => setActionButtonSelector(e.target.value)}
                placeholder="Varsayılan: Oynat (ytp-play-button) / Devam Et / Continue"
                className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          )}

          {needsMoreProxies && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" />
                <span>
                  En az <strong className="font-mono">{desiredSessionCount}</strong> farklı doğrulanmış IP gerekiyor
                  (mevcut doğrulanmış IP: <strong className="font-mono">{verifiedUniqueCount}</strong>). Simülasyon yapılmadığı için önce IP havuzunu doldurun.
                </span>
              </div>
              <button
                type="button"
                onClick={onOpenProxyTab}
                className="px-3 py-1.5 rounded-md bg-white border border-amber-300 text-amber-900 font-medium hover:bg-amber-100 whitespace-nowrap shrink-0"
              >
                IP Havuzunu Tara
              </button>
            </div>
          )}

          {formError && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
              <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}
        </form>
      </section>

      {activeRun ? (
        <>
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Canlı Oturum Yürütme Özeti
                </h3>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  {activeRun.id} ·{' '}
                  {activeRun.config.mode === 'exact-link'
                    ? activeRun.config.targetUrl
                    : `@${activeRun.config.username}`}
                  {activeRun.resolvedTargetTitle ? ` · ${activeRun.resolvedTargetTitle}` : ''}
                </p>
              </div>
              <div className="text-xs font-medium flex flex-wrap items-center gap-3">
                <span className="font-mono text-slate-600 tabular-nums">
                  {activeRun.sessions.filter((s) => s.status === 'matched' || s.status === 'not-found' || s.status === 'proxy-error').length}/
                  {activeRun.totalSessionsPlanned} tamamlandı ·{' '}
                  {activeRun.sessions.filter((s) => s.status === 'searching' || s.status === 'initializing' || s.status === 'navigating-match' || s.status === 'watching').length} aktif ·{' '}
                  {activeRun.sessions.filter((s) => s.status === 'queued').length} sırada
                </span>
                {activeRun.status === 'running' ? (
                  <span className="inline-flex items-center gap-1.5 text-blue-700">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Gerçek Oturumlar Çalışıyor</span>
                  </span>
                ) : activeRun.status === 'completed' ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Tamamlandı</span>
                  </span>
                ) : (
                  <span className="text-amber-700">
                    {activeRun.status === 'stopped' ? 'Durduruldu' : 'Hata'}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-slate-500">Planlanan Oturum</div>
                <div className="font-mono text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
                  {activeRun.totalSessionsPlanned}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Kullanılan Benzersiz IP</div>
                <div className="font-mono text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
                  {activeRun.uniqueIpsUsed}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Birebir Hedefe Ulaşan</div>
                <div className="font-mono text-2xl font-semibold text-emerald-700 mt-1 tabular-nums">
                  {activeRun.matchedSessionsCount}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Açılmadan Atlanan Aday</div>
                <div className="font-mono text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
                  {activeRun.skippedCandidatesCount}
                </div>
              </div>
            </div>

            {discoverabilityStats && (
              <div className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 text-xs">
                <div>
                  <div className="text-slate-500">En İyi / Ortalama Sıra</div>
                  <div className="font-mono text-slate-900 font-medium mt-0.5 tabular-nums">
                    {discoverabilityStats.bestRank !== null
                      ? `Sayfa ${discoverabilityStats.bestPage ?? 1} · #${discoverabilityStats.bestRank} (Ort. #${discoverabilityStats.avgRank})`
                      : 'Henüz sıralama yok'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">En Başarılı Arama Sorgusu</div>
                  <div className="text-slate-900 font-medium mt-0.5 truncate" title={discoverabilityStats.topQuery || undefined}>
                    {discoverabilityStats.topQuery || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Ağ Tipine Göre Başarı</div>
                  <div className="font-mono text-slate-900 font-medium mt-0.5 tabular-nums">
                    ISP: {discoverabilityStats.ispMatched} · Veri Merkezi: {discoverabilityStats.dcMatched}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Video İzleme &amp; Watchtime Pingi</div>
                  <div className="font-mono text-slate-900 font-medium mt-0.5 tabular-nums">
                    {discoverabilityStats.watchedTargetCount} oturum · Ort. {discoverabilityStats.avgWatchSeconds} sn · {discoverabilityStats.totalWatchtimePings} ping
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Katman Tutarlılığı &amp; Rotasyon</div>
                  <div className="font-mono text-slate-900 font-medium mt-0.5 tabular-nums">
                    Tut.: %{discoverabilityStats.avgConsistency} · Engel: {discoverabilityStats.botGates} · Rotasyon: {discoverabilityStats.totalFailovers}
                  </div>
                </div>
              </div>
            )}
          </section>

          {activeRun.osintHits.length > 0 && (
            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200">
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Gerçek Platform &amp; Görsel Eşleştirme Sonuçları
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Bulunan gerçek profil uç noktaları, ipucu eşleşmeleri ve algısal dHash görsel benzerliği.
                </p>
              </div>
              <div className="divide-y divide-slate-200">
                {activeRun.osintHits.map((hit, idx) => (
                  <div
                    key={`${hit.platform}-${idx}`}
                    className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50"
                  >
                    <div className="flex items-start gap-3.5 min-w-0">
                      {hit.avatarUrl ? (
                        <img
                          src={hit.avatarUrl}
                          alt={`${hit.platform} profil görseli`}
                          referrerPolicy="no-referrer"
                          className="w-11 h-11 rounded-lg object-cover border border-slate-200 shrink-0 bg-slate-100"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-lg border border-slate-200 bg-slate-100 flex items-center justify-center shrink-0 text-slate-400">
                          <ImageIcon className="w-5 h-5" />
                        </div>
                      )}
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-semibold text-slate-900">{hit.platform}</span>
                          <span aria-hidden="true" className="text-slate-400">·</span>
                          <span className="font-mono text-slate-700">@{hit.usernameFound}</span>
                          {hit.displayName && (
                            <>
                              <span aria-hidden="true" className="text-slate-400">·</span>
                              <span className="text-slate-600">{hit.displayName}</span>
                            </>
                          )}
                        </div>
                        {hit.bio && (
                          <p className="text-xs text-slate-600 line-clamp-2">{hit.bio}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                          <span>Güven: %{hit.confidenceScore}</span>
                          {hit.imageSimilarityPercent !== null && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>Görsel Benzerlik: %{hit.imageSimilarityPercent}</span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span>Çıkış IP: {hit.verifiedByExitIp}</span>
                          {hit.clueMatches.length > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-emerald-700">
                                İpucu: {hit.clueMatches.join(', ')}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <a
                      href={hit.profileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 hover:bg-slate-100 whitespace-nowrap shrink-0 self-start sm:self-center"
                    >
                      <span>Profili Aç</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  İzole Oturum Matrisi
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Aday bağlantıları ve doğrulama kanıtını görmek için herhangi bir oturum satırını seçin.
                </p>
              </div>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {activeRun.sessions.length} oturum
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                    <th className="py-2.5 px-2">Oturum</th>
                    <th className="py-2.5 px-2">Çıkış IP · Ülke · Ağ</th>
                    <th className="py-2.5 px-2">Protokol</th>
                    <th className="py-2.5 px-2">Durum</th>
                    <th className="py-2.5 px-2 text-right">Sıra</th>
                    <th className="py-2.5 px-2 text-right">İzleme</th>
                    <th className="py-2.5 px-2 text-right">Aday</th>
                    <th className="py-2.5 px-2">Hedef Başlığı / Not</th>
                    <th className="py-2.5 px-2 text-right">Süre</th>
                    <th className="py-2.5 px-2 text-right">Detay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {activeRun.sessions.map((sess) => {
                    const targetWatch = sess.targetWatchSeconds ?? activeRun.config.minWatchSeconds ?? 0;
                    const actualWatch = Math.round(sess.watchSecondsActual ?? 0);
                    return (
                    <tr
                      key={sess.sessionId}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="py-2.5 px-2 font-mono font-medium text-slate-900 whitespace-nowrap tabular-nums">
                        #{String(sess.sessionIndex).padStart(2, '0')}
                      </td>
                      <td className="py-2.5 px-2 font-mono text-slate-800 whitespace-nowrap tabular-nums">
                        <div>{sess.exitIp}</div>
                        {(sess.country || (sess.networkType && sess.networkType !== 'unknown')) && (
                          <div className="font-sans text-[11px] leading-tight mt-0.5">
                            {sess.country && <span className="text-slate-500">{sess.country}</span>}
                            {sess.country && sess.networkType && sess.networkType !== 'unknown' && (
                              <span className="text-slate-400"> · </span>
                            )}
                            {sess.networkType && sess.networkType !== 'unknown' && (
                              <span
                                className={
                                  sess.networkType === 'residential-isp' ? 'text-emerald-700' : 'text-amber-700'
                                }
                              >
                                {sess.networkType === 'residential-isp' ? 'ISP' : 'Veri Mrk.'}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-2 font-mono uppercase text-slate-600 whitespace-nowrap">
                        {sess.protocol}
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        {renderSessionStatus(sess)}
                      </td>
                      <td className="py-2.5 px-2 font-mono text-right text-slate-800 tabular-nums whitespace-nowrap">
                        {sess.foundAtRank ? `S${sess.foundAtPage ?? 1} · #${sess.foundAtRank}` : '—'}
                      </td>
                      <td
                        className="py-2.5 px-2 font-mono text-right tabular-nums whitespace-nowrap"
                        title={
                          sess.videoDurationSeconds
                            ? `Video uzunluğu: ${formatClockSeconds(sess.videoDurationSeconds)}`
                            : undefined
                        }
                      >
                        {targetWatch > 0 && (actualWatch > 0 || sess.status === 'watching' || sess.status === 'matched') ? (
                          <div>
                            <span
                              className={
                                actualWatch >= targetWatch || sess.playbackStatus === 'completed'
                                  ? 'text-emerald-700 font-medium'
                                  : sess.status === 'watching'
                                  ? 'text-blue-700 font-medium'
                                  : 'text-slate-600'
                              }
                            >
                              {actualWatch} / {targetWatch} sn
                            </span>
                            {(sess.watchtimePingCount ?? 0) > 0 && (
                              <div className="text-[10px] text-slate-500">
                                {sess.watchtimePingCount} ping
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 font-mono text-right text-slate-800 tabular-nums whitespace-nowrap">
                        {sess.candidatesInspected} / {sess.candidatesSkipped}
                      </td>
                      <td className="py-2.5 px-2 text-slate-700">
                        <div className="max-w-[140px] 2xl:max-w-[220px]">
                          <div className="truncate">
                            {sess.resolvedTitle || sess.error || sess.searchQuery}
                          </div>
                          {(sess.matchedQuery ||
                            sess.consentDismissed ||
                            sess.actionButtonClicked ||
                            sess.profileState === 'reused-warm' ||
                            sess.profileState === 'warmed' ||
                            sess.sessionDepthTitle ||
                            sess.trafficStatus === 'bot-gate-detected') && (
                            <div className="text-[11px] text-slate-500 truncate mt-0.5">
                              {sess.matchedQuery && `Sorgu: ${sess.matchedQuery}`}
                              {sess.matchedQuery && (sess.profileState === 'reused-warm' || sess.profileState === 'warmed') && ' · '}
                              {sess.profileState === 'reused-warm'
                                ? 'Isınmış profil'
                                : sess.profileState === 'warmed'
                                ? 'Yeni ısıtıldı'
                                : sess.profileState === 'quarantined'
                                ? 'Profil karantinada'
                                : ''}
                              {sess.sessionDepthTitle && ` · +Sonraki: ${sess.sessionDepthTitle}`}
                              {sess.consentDismissed && ` · Çerez geçildi (${sess.consentButtonLabel || 'OK'})`}
                              {sess.actionButtonClicked && ` · Buton: ${sess.actionButtonClicked}`}
                              {sess.trafficStatus === 'bot-gate-detected' && (
                                <span className="text-amber-700">
                                  {' · '}
                                  {sess.trafficGateReason || 'Bot/giriş engeli algılandı'}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 font-mono text-right text-slate-600 tabular-nums whitespace-nowrap">
                        {sess.durationMs !== null
                          ? sess.durationMs >= 10000
                            ? `${(sess.durationMs / 1000).toFixed(1)} sn`
                            : `${sess.durationMs} ms`
                          : '—'}
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onSelectSession(sess)}
                          aria-label={`Oturum #${String(sess.sessionIndex).padStart(2, '0')} detayını aç`}
                          className="px-2.5 py-1 rounded-md border border-slate-300 bg-white text-slate-700 font-medium hover:bg-slate-100"
                        >
                          İncele
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="bg-white border border-slate-200 rounded-xl px-6 py-10 text-center space-y-2">
          <h3 className="font-display text-base font-semibold text-slate-900">
            Çalışan veya Seçili Görev Yok
          </h3>
          <p className="text-sm text-slate-600 max-w-lg mx-auto">
            Yukarıdan bir YouTube video linki veya kullanıcı adı/görsel girin. Sistem, en az 30 farklı gerçek IP oturumuyla arama yapıp yalnızca birebir hedef eşleşmesine tıklar.
          </p>
        </section>
      )}
    </div>
  );
}
