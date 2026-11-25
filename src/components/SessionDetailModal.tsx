import { useEffect } from 'react';
import { CheckCircle2, ExternalLink, SkipForward, X, AlertCircle } from 'lucide-react';
import type { SessionExecution } from '../types/automation';
import { formatClockSeconds } from '../lib/targetMatcher';

interface SessionDetailModalProps {
  session: SessionExecution | null;
  onClose: () => void;
}

export function SessionDetailModal({ session, onClose }: SessionDetailModalProps) {
  useEffect(() => {
    if (!session) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session, onClose]);

  if (!session) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden shadow-lg">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-slate-200">
          <div className="min-w-0">
            <h2 id="session-modal-title" className="font-display text-base font-semibold text-slate-900">
              Oturum #{session.sessionIndex} Denetim Kaydı
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums break-words">
              {session.sessionId} · Çıkış IP: {session.exitIp} · {session.protocol.toUpperCase()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Oturum detayını kapat"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm pb-5 border-b border-slate-200">
            <div>
              <div className="text-xs text-slate-500">Proxy · Ülke · Ağ Tipi</div>
              <div className="font-mono text-slate-900 mt-0.5 tabular-nums">
                {session.proxyAddress} ({session.country || 'Bilinmiyor'})
                {session.networkType && session.networkType !== 'unknown'
                  ? ` · ${session.networkType === 'residential-isp' ? 'ISP / Yerleşik' : 'Veri Merkezi'}`
                  : ''}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Arama Sorgusu &amp; SERP Konumu</div>
              <div className="text-slate-900 mt-0.5 truncate">
                {session.matchedQuery || session.searchQuery}
                {session.foundAtRank
                  ? ` (Sayfa ${session.foundAtPage ?? 1} · Sıra #${session.foundAtRank})`
                  : ''}
              </div>
            </div>
            <div className="sm:col-span-2">
              <div className="text-xs text-slate-500">İzole Tarayıcı Kimliği (User-Agent · Coğrafi Yerel Ayar)</div>
              <div className="font-mono text-xs text-slate-700 mt-0.5 break-all">
                {session.userAgent} · {session.locale}
                {session.timezoneId ? ` · ${session.timezoneId}` : ''}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Çerez Penceresi &amp; Trafik Kontrolü</div>
              <div className="text-xs text-slate-900 mt-0.5">
                {session.trafficStatus === 'bot-gate-detected'
                  ? session.trafficGateReason || 'Bot / oturum doğrulaması algılandı'
                  : session.consentDismissed
                  ? `Çerez geçildi (${session.consentButtonLabel || 'Otomatik'})`
                  : session.trafficStatus === 'clear'
                  ? 'Temiz erişim (engel yok)'
                  : 'Beklemede'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Hedef Sayfa Buton Etkileşimi</div>
              <div className="font-mono text-xs text-slate-900 mt-0.5">
                {session.actionButtonClicked || 'Basılan ek buton yok'}
              </div>
            </div>
            <div className="sm:col-span-2">
              <div className="text-xs text-slate-500">Video İzleme &amp; Oynatma Doğrulaması</div>
              <div className="font-mono text-xs text-slate-900 mt-0.5 tabular-nums flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>
                  {(session.targetWatchSeconds ?? 0) > 0
                    ? `${Math.round(session.watchSecondsActual ?? 0)} / ${session.targetWatchSeconds} sn`
                    : `${Math.round(session.watchSecondsActual ?? 0)} sn`}
                </span>
                <span aria-hidden="true" className="text-slate-400">·</span>
                <span>
                  {session.playbackStatus === 'completed'
                    ? 'Oynatma Hedefi Tamamlandı'
                    : session.playbackStatus === 'playing'
                    ? 'Aktif Oynatılıyor'
                    : session.playbackStatus === 'stalled'
                    ? 'Akış Yavaş / Durakladı'
                    : session.playbackStatus === 'blocked'
                    ? 'Bot / Oturum Engeli'
                    : session.playbackStatus === 'no-video'
                    ? 'Video Oynatıcı Yok'
                    : 'Beklemede'}
                </span>
                {typeof session.videoDurationSeconds === 'number' && session.videoDurationSeconds > 0 && (
                  <>
                    <span aria-hidden="true" className="text-slate-400">·</span>
                    <span>Video Süresi: {formatClockSeconds(session.videoDurationSeconds)}</span>
                  </>
                )}
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500">YouTube Watchtime Telemetrisi</div>
              <div className="font-mono text-xs text-slate-900 mt-0.5 tabular-nums">
                {(session.watchtimePingCount ?? 0) > 0
                  ? `${session.watchtimePingCount} ping doğrulandı (HTTP ${session.lastWatchtimePingStatus ?? 204})`
                  : 'Telemetri pingi algılanmadı'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Profil &amp; Oturum Derinliği</div>
              <div className="text-xs text-slate-900 mt-0.5">
                <span>
                  {session.profileState === 'reused-warm'
                    ? 'Isınmış çerez profili kullanıldı'
                    : session.profileState === 'warmed'
                    ? 'Oturum öncesi ısıtıldı'
                    : 'Soğuk oturum'}
                </span>
                {session.sessionDepthTitle && (
                  <span className="text-slate-600">
                    {' · Sonraki video: '}
                    {session.sessionDepthTitle}
                  </span>
                )}
              </div>
            </div>
          </div>

          {session.error && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>{session.error}</span>
            </div>
          )}

          {session.matchedUrl && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-700">Doğrulanan Hedef Bağlantı</h3>
              <div className="flex items-center justify-between gap-3 p-3.5 rounded-lg bg-emerald-50 border border-emerald-200">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-emerald-950 truncate">
                    {session.resolvedTitle || session.matchedUrl}
                  </div>
                  <div className="font-mono text-xs text-emerald-800 truncate mt-0.5">
                    {session.matchedUrl}
                  </div>
                </div>
                <a
                  href={session.matchedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-emerald-300 text-xs font-medium text-emerald-900 hover:bg-emerald-100 whitespace-nowrap shrink-0"
                >
                  <span>Aç</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          )}

          {session.screenshotUrl && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-700">
                Gerçek Chromium Ekran Görüntüsü Kanıtı
              </h3>
              <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-100">
                <img
                  src={session.screenshotUrl}
                  alt={`Oturum ${session.sessionIndex} hedef doğrulama ekran görüntüsü`}
                  referrerPolicy="no-referrer"
                  className="w-full h-auto block"
                />
              </div>
            </div>
          )}

          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-slate-700">
                Aday Bağlantı Karar Günlüğü
              </h3>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {session.decisions.length} aday incelendi · {session.candidatesSkipped} atlandı
              </span>
            </div>

            {session.decisions.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 border border-slate-200 rounded-lg text-center">
                Henüz aday bağlantı kaydı oluşmadı.
              </p>
            ) : (
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 max-h-72 overflow-y-auto">
                {session.decisions.map((dec, idx) => {
                  const isClick = dec.decision === 'clicked-exact-match';
                  return (
                    <div key={`${dec.url}-${idx}`} className="px-3.5 py-2.5 flex items-start justify-between gap-3 text-xs">
                      <div className="min-w-0 space-y-0.5">
                        <div className="font-medium text-slate-900 truncate">{dec.title}</div>
                        <div className="font-mono text-slate-500 truncate">{dec.url}</div>
                        <div className={isClick ? 'text-emerald-700 font-medium' : 'text-slate-600'}>
                          {dec.reason}
                        </div>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 font-medium whitespace-nowrap shrink-0 ${
                          isClick ? 'text-emerald-700' : 'text-slate-500'
                        }`}
                      >
                        {isClick ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Tıklandı</span>
                          </>
                        ) : (
                          <>
                            <SkipForward className="w-3.5 h-3.5" />
                            <span>Atlandı</span>
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 whitespace-nowrap"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
}
