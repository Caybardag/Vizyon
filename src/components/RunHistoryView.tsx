import { useMemo } from 'react';
import { CheckCircle2, Eye, Loader2, OctagonX } from 'lucide-react';
import type { RunRecord } from '../types/automation';
import { buildRankTrendSeries } from '../lib/targetMatcher';

interface RunHistoryViewProps {
  runs: RunRecord[];
  onInspectRun: (run: RunRecord) => void;
}

export function RunHistoryView({ runs, onInspectRun }: RunHistoryViewProps) {
  const trendSeries = useMemo(() => buildRankTrendSeries(runs), [runs]);
  const latestTrend = trendSeries[trendSeries.length - 1] ?? null;
  const bestOverallRank = useMemo(() => {
    const ranks = trendSeries
      .map((t) => t.bestRank)
      .filter((r): r is number => typeof r === 'number' && r > 0);
    return ranks.length > 0 ? Math.min(...ranks) : null;
  }, [trendSeries]);

  return (
    <div className="space-y-6">
      {trendSeries.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200">
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-900">
                Keşfedilebilirlik &amp; Sıralama Zaman Serisi
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Son {trendSeries.length} görevdeki arama sonucu sırası (SERP), hedef eşleşme oranı ve YouTube watchtime telemetri doğrulaması.
              </p>
            </div>
            <div className="font-mono text-xs text-slate-600 tabular-nums flex flex-wrap items-center gap-2">
              <span>En İyi Sıra: {bestOverallRank ? `#${bestOverallRank}` : '—'}</span>
              <span aria-hidden="true">·</span>
              <span>
                Son Telemetri: %{latestTrend?.telemetryRatePercent ?? 0}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
            <div className="lg:col-span-8">
              <div className="text-xs text-slate-500 mb-2">
                Görev Bazlı Eşleşme (%) ve Watchtime Telemetri Oranı (%)
              </div>
              <div className="overflow-x-auto pb-1">
                <div className="flex items-end gap-3 min-w-[320px] h-36 pt-4 border-b border-slate-200">
                  {trendSeries.map((pt) => (
                    <div
                      key={pt.runId}
                      className="flex-1 min-w-[44px] max-w-[72px] flex flex-col items-center gap-1.5"
                      title={`${pt.runId} · Eşleşme: %${pt.matchRatePercent} · Telemetri: %${pt.telemetryRatePercent} · En iyi sıra: ${pt.bestRank ? `#${pt.bestRank}` : '—'}`}
                    >
                      <div className="font-mono text-[10px] text-slate-700 tabular-nums">
                        {pt.bestRank ? `#${pt.bestRank}` : '—'}
                      </div>
                      <div className="w-full h-20 flex items-end justify-center gap-1">
                        <div
                          className="w-3.5 bg-blue-600 rounded-t-sm transition-all"
                          style={{ height: `${Math.max(4, Math.round((pt.matchRatePercent / 100) * 80))}px` }}
                          aria-label={`${pt.runId} eşleşme oranı yüzde ${pt.matchRatePercent}`}
                        />
                        <div
                          className="w-3.5 bg-emerald-600 rounded-t-sm transition-all"
                          style={{ height: `${Math.max(4, Math.round((pt.telemetryRatePercent / 100) * 80))}px` }}
                          aria-label={`${pt.runId} telemetri oranı yüzde ${pt.telemetryRatePercent}`}
                        />
                      </div>
                      <div className="font-mono text-[10px] text-slate-500 truncate w-full text-center">
                        {pt.runId.replace(/^run-/, '')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-4 text-[11px] text-slate-600 mt-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-blue-600 rounded-xs inline-block" aria-hidden="true" />
                  <span>Hedefe Ulaşma (%)</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-emerald-600 rounded-xs inline-block" aria-hidden="true" />
                  <span>Watchtime Ping Doğrulaması (%)</span>
                </span>
                <span className="text-slate-400">· Üst etiket: En İyi SERP Sırası</span>
              </div>
            </div>

            <div className="lg:col-span-4 grid grid-cols-2 gap-4 pt-2 lg:pt-0 lg:pl-4 lg:border-l border-slate-200">
              <div>
                <div className="text-xs text-slate-500">Son Görev Eşleşmesi</div>
                <div className="font-mono text-xl font-semibold text-slate-900 mt-0.5 tabular-nums">
                  {latestTrend ? `%${latestTrend.matchRatePercent}` : '—'}
                </div>
                <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                  {latestTrend ? `${latestTrend.matchedCount}/${latestTrend.totalCount} oturum` : ''}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Ortalama SERP Sırası</div>
                <div className="font-mono text-xl font-semibold text-slate-900 mt-0.5 tabular-nums">
                  {latestTrend?.avgRank ? `#${latestTrend.avgRank}` : '—'}
                </div>
                <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                  ISP eşleşmesi: {latestTrend?.ispMatchedCount ?? 0}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">
            Doğrulama ve Keşif Geçmişi
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Diskte saklanan gerçek çoklu IP görev kayıtları ve oturum denetim sonuçları.
          </p>
        </div>
        <span className="font-mono text-xs text-slate-500 tabular-nums">{runs.length} kayıt</span>
      </div>

      {runs.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-slate-500">
          Henüz tamamlanmış veya başlatılmış bir görev kaydı bulunmuyor.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                <th className="py-2.5 px-4">Görev ID</th>
                <th className="py-2.5 px-4">Mod & Hedef</th>
                <th className="py-2.5 px-4 text-right">Benzersiz IP</th>
                <th className="py-2.5 px-4 text-right">Eşleşen / Toplam</th>
                <th className="py-2.5 px-4 text-right">Atlanan Aday</th>
                <th className="py-2.5 px-4">Durum</th>
                <th className="py-2.5 px-4 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {runs.map((run) => (
                <tr key={run.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono text-slate-900 whitespace-nowrap">
                    <div>{run.id}</div>
                    <div className="text-[11px] text-slate-500">
                      {new Date(run.createdAt).toLocaleString('tr-TR')}
                    </div>
                  </td>
                  <td className="py-3 px-4 max-w-xs">
                    <div className="font-medium text-slate-900">
                      {run.config.mode === 'exact-link'
                        ? 'Birebir Bağlantı / Video Hedefi'
                        : 'Kullanıcı Adı & Görsel Keşfi'}
                      {(run.config.minWatchSeconds ?? 0) > 0 && (
                        <span className="ml-2 font-mono text-[11px] font-normal text-blue-700">
                          · {run.config.minWatchSeconds} sn izleme
                        </span>
                      )}
                    </div>
                    <div className="text-slate-600 truncate mt-0.5">
                      {run.config.mode === 'exact-link'
                        ? run.config.targetUrl
                        : `@${run.config.username}${run.config.clues ? ` · ${run.config.clues}` : ''}`}
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono text-right text-slate-900 tabular-nums">
                    {run.uniqueIpsUsed}
                  </td>
                  <td className="py-3 px-4 font-mono text-right text-slate-900 tabular-nums">
                    {run.matchedSessionsCount} / {run.totalSessionsPlanned}
                  </td>
                  <td className="py-3 px-4 font-mono text-right text-slate-700 tabular-nums">
                    {run.skippedCandidatesCount}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    {run.status === 'running' ? (
                      <span className="inline-flex items-center gap-1.5 text-blue-700 font-medium">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Çalışıyor</span>
                      </span>
                    ) : run.status === 'completed' ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-700 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Tamamlandı</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-amber-700 font-medium">
                        <OctagonX className="w-3.5 h-3.5" />
                        <span>{run.status === 'stopped' ? 'Durduruldu' : 'Hata'}</span>
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onInspectRun(run)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 font-medium"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>İncele</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </section>
    </div>
  );
}
