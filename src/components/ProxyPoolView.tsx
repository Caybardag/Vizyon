import { useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Square,
  Terminal,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { HarvestProgress, ProxyEndpoint, ProxyNetworkType, ProxyProtocol } from '../types/automation';

interface ProxyPoolViewProps {
  proxies: ProxyEndpoint[];
  progress: HarvestProgress;
  verifiedUniqueCount: number;
  warmProfilesCount: number;
  onStartHarvest: (targetCount: number) => Promise<void>;
  onStopHarvest: () => Promise<void>;
  onReverifyProxies: () => Promise<void>;
  onImportProxies: (rawText: string, protocol: ProxyProtocol) => Promise<{ parsedCount: number; verifiedCount: number }>;
  onClearProxies: () => Promise<void>;
}

const FREE_TUNNEL_SNIPPETS = [
  {
    id: 'ssh',
    label: 'SSH Dinamik SOCKS5 Tüneli (Ev / VPS — %100 Ücretsiz)',
    cmd: 'ssh -D 0.0.0.0:1080 -N -C kullanici@sunucu-veya-ev-ip',
  },
  {
    id: 'tailscale',
    label: 'Tailscale + Ücretsiz Ev Çıkış Düğümü (Exit Node)',
    cmd: 'tailscale up --exit-node=ev-cihazi --socks5-server=0.0.0.0:1055',
  },
];

export function ProxyPoolView({
  proxies,
  progress,
  verifiedUniqueCount,
  warmProfilesCount,
  onStartHarvest,
  onStopHarvest,
  onReverifyProxies,
  onImportProxies,
  onClearProxies,
}: ProxyPoolViewProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'verified' | 'failed'>('all');
  const [protocolFilter, setProtocolFilter] = useState<'all' | ProxyProtocol>('all');
  const [networkFilter, setNetworkFilter] = useState<'all' | ProxyNetworkType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [targetCount, setTargetCount] = useState(45);

  const [showImport, setShowImport] = useState(false);
  const [showTunnelGuide, setShowTunnelGuide] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [importProtocol, setImportProtocol] = useState<ProxyProtocol>('http');
  const [importing, setImporting] = useState(false);
  const [importFeedback, setImportFeedback] = useState<string | null>(null);

  const handleCopyCommand = async (id: string, cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1800);
    } catch {
      // Clipboard unavailable in restricted context
    }
  };

  const ispVerifiedCount = useMemo(
    () => proxies.filter((p) => p.status === 'verified' && p.networkType === 'residential-isp').length,
    [proxies]
  );

  const filteredProxies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return proxies.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (protocolFilter !== 'all' && p.protocol !== protocolFilter) return false;
      if (networkFilter !== 'all' && (p.networkType ?? 'unknown') !== networkFilter) return false;
      if (q) {
        const hay = `${p.host}:${p.port} ${p.exitIp ?? ''} ${p.country ?? ''} ${p.isp ?? ''} ${p.source}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [proxies, statusFilter, protocolFilter, networkFilter, searchQuery]);

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importText.trim()) return;
    setImporting(true);
    setImportFeedback(null);
    try {
      const res = await onImportProxies(importText, importProtocol);
      setImportFeedback(
        `${res.parsedCount} proxy ayrıştırıldı, ${res.verifiedCount} tanesi gerçek HTTPS CONNECT ile doğrulandı.`
      );
      if (res.verifiedCount > 0) {
        setImportText('');
      }
    } catch (err) {
      setImportFeedback(err instanceof Error ? err.message : 'İçe aktarım başarısız.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Ücretsiz Açık Kaynak Proxy & Çıkış IP Havuzu
            </h2>
            <p className="text-sm text-slate-600 max-w-2xl">
              ProxyScrape, GeoNode, TheSpeedX ve Monosans açık kaynak listelerinden ücretsiz proxy çeker;
              her birini gerçek HTTPS CONNECT tüneli üzerinden test ederek benzersiz çıkış IP’lerini doğrular.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <span>Hedef IP:</span>
              <input
                type="number"
                min={30}
                max={80}
                value={targetCount}
                onChange={(e) => setTargetCount(Math.max(30, Number(e.target.value) || 30))}
                className="w-16 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-mono text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </label>

            {progress.running ? (
              <button
                type="button"
                onClick={onStopHarvest}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 whitespace-nowrap shrink-0"
              >
                <Square className="w-4 h-4" />
                <span>Taramayı Durdur</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onStartHarvest(targetCount)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <RefreshCw className="w-4 h-4" />
                <span>30+ IP Tara &amp; Doğrula</span>
              </button>
            )}

            {verifiedUniqueCount > 0 && !progress.running && (
              <button
                type="button"
                onClick={onReverifyProxies}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Sağlık Testi</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowImport((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Özel Proxy Ekle</span>
            </button>

            <button
              type="button"
              onClick={() => setShowTunnelGuide((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Terminal className="w-4 h-4" />
              <span>Ücretsiz Ev / Mobil Tünel</span>
            </button>

            {proxies.length > 0 && !progress.running && (
              <button
                type="button"
                onClick={onClearProxies}
                aria-label="Tüm proxy listesini temizle"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm hover:text-red-700 hover:border-red-200 hover:bg-red-50 whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-4 h-4" />
                <span>Temizle</span>
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-slate-200">
          <div>
            <div className="text-xs text-slate-500">Doğrulanmış Benzersiz IP</div>
            <div className="font-mono text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
              {verifiedUniqueCount}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
              ISP: {ispVerifiedCount} · Isınmış profil: {warmProfilesCount}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Listeden Çekilen Aday</div>
            <div className="font-mono text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
              {progress.fetchedCount}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Test Edilen Proxy</div>
            <div className="font-mono text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
              {progress.probedCount}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Tarama Durumu</div>
            <div className="text-sm font-medium text-slate-900 mt-2 flex items-center gap-2">
              {progress.running ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600 shrink-0" />
                  <span className="truncate">{progress.currentFeed || 'Test ediliyor...'}</span>
                </>
              ) : (
                <span>
                  {progress.phase === 'completed'
                    ? 'Tamamlandı'
                    : progress.phase === 'stopped'
                    ? 'Durduruldu'
                    : 'Beklemede'}
                </span>
              )}
            </div>
          </div>
        </div>

        {showImport && (
          <form onSubmit={handleImportSubmit} className="pt-4 border-t border-slate-200 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label htmlFor="custom-proxy-textarea" className="text-sm font-medium text-slate-900">
                Özel HTTP / SOCKS4 / SOCKS5 Proxy Listesi (satır başına bir adet)
              </label>
              <select
                value={importProtocol}
                onChange={(e) => setImportProtocol(e.target.value as ProxyProtocol)}
                aria-label="Varsayılan proxy protokolü"
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800"
              >
                <option value="http">Varsayılan: HTTP</option>
                <option value="socks5">Varsayılan: SOCKS5</option>
                <option value="socks4">Varsayılan: SOCKS4</option>
              </select>
            </div>
            <textarea
              id="custom-proxy-textarea"
              rows={4}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={'socks5://45.12.34.56:1080\n103.28.37.131:3129'}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 font-mono text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-slate-600">{importFeedback || ''}</span>
              <button
                type="submit"
                disabled={importing || !importText.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
              >
                {importing && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Doğrula ve Havuza Ekle</span>
              </button>
            </div>
          </form>
        )}

        {showTunnelGuide && (
          <div className="pt-4 border-t border-slate-200 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Kendi Ücretsiz Ev / Mobil IP&apos;nizi Bağlama (Sıfır Maliyet)
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Açık proxy yerine kendi ev veya mobil ağınızdan SOCKS5 tüneli açıp &ldquo;Özel Proxy Ekle&rdquo; alanına{' '}
                  <code className="font-mono text-slate-800">socks5://IP:1080</code> olarak eklerseniz otomatik en yüksek öncelikli{' '}
                  <strong>ISP / Yerleşik</strong> olarak sınıflandırılır.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowImport(true);
                  setImportProtocol('socks5');
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 self-start"
              >
                SOCKS5 Ekleme Formunu Aç
              </button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {FREE_TUNNEL_SNIPPETS.map((item) => (
                <div key={item.id} className="space-y-1.5 pt-2 border-t border-slate-100">
                  <div className="text-xs font-medium text-slate-700">{item.label}</div>
                  <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
                    <code className="font-mono text-[11px] text-slate-900 truncate">{item.cmd}</code>
                    <button
                      type="button"
                      onClick={() => handleCopyCommand(item.id, item.cmd)}
                      aria-label={`${item.label} komutunu kopyala`}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-slate-700 hover:bg-slate-200 whitespace-nowrap shrink-0"
                    >
                      {copiedId === item.id ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-700" />
                          <span className="text-emerald-700">Kopyalandı</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Kopyala</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
            {(
              [
                { id: 'all', label: 'Tümü' },
                { id: 'verified', label: 'Doğrulananlar' },
                { id: 'failed', label: 'Başarısız' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setStatusFilter(item.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  statusFilter === item.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={networkFilter}
              onChange={(e) => setNetworkFilter(e.target.value as 'all' | ProxyNetworkType)}
              aria-label="Ağ tipine göre filtrele"
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700"
            >
              <option value="all">Tüm Ağ Tipleri</option>
              <option value="residential-isp">ISP / Yerleşik</option>
              <option value="datacenter">Veri Merkezi (Cloud)</option>
              <option value="unknown">Sınıflandırılmamış</option>
            </select>

            <select
              value={protocolFilter}
              onChange={(e) => setProtocolFilter(e.target.value as 'all' | ProxyProtocol)}
              aria-label="Protokole göre filtrele"
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700"
            >
              <option value="all">Tüm Protokoller</option>
              <option value="http">HTTP</option>
              <option value="socks5">SOCKS5</option>
              <option value="socks4">SOCKS4</option>
            </select>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="IP, ülke veya kaynak ara..."
                aria-label="Proxy tablosunda ara"
                className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900 w-52 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>
        </div>

        {filteredProxies.length === 0 ? (
          <div className="px-6 py-12 text-center space-y-3">
            <p className="text-sm font-medium text-slate-900">
              {proxies.length === 0
                ? 'Henüz doğrulanmış proxy yok.'
                : 'Seçili filtrelere uyan proxy bulunamadı.'}
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Gerçek çoklu IP oturumlarını başlatmak için yukarıdaki &ldquo;30+ IP Tara &amp; Doğrula&rdquo; butonuna tıklayın veya kendi ücretsiz proxy listenizi ekleyin.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                  <th className="py-2.5 px-4">Proxy Adresi</th>
                  <th className="py-2.5 px-4">Protokol</th>
                  <th className="py-2.5 px-4">Gerçek Çıkış IP</th>
                  <th className="py-2.5 px-4">Ülke · Sağlayıcı</th>
                  <th className="py-2.5 px-4">Ağ Tipi</th>
                  <th className="py-2.5 px-4">Kaynak</th>
                  <th className="py-2.5 px-4 text-right">Gecikme</th>
                  <th className="py-2.5 px-4">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredProxies.slice(0, 120).map((proxy) => (
                  <tr key={proxy.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-4 font-mono text-slate-900 tabular-nums whitespace-nowrap">
                      {proxy.host}:{proxy.port}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-700 uppercase">
                      {proxy.protocol}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-900 tabular-nums whitespace-nowrap">
                      {proxy.exitIp || '—'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700 max-w-[220px] truncate">
                      {proxy.country
                        ? `${proxy.country}${proxy.isp ? ` · ${proxy.isp}` : ''}`
                        : '—'}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {proxy.networkType === 'residential-isp' ? (
                        <span className="text-emerald-700 font-medium">ISP / Yerleşik</span>
                      ) : proxy.networkType === 'datacenter' ? (
                        <span className="text-amber-700 font-medium">Veri Merkezi</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">{proxy.source}</td>
                    <td className="py-2.5 px-4 font-mono text-right text-slate-900 tabular-nums whitespace-nowrap">
                      {proxy.latencyMs !== null ? `${proxy.latencyMs} ms` : '—'}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {proxy.status === 'verified' ? (
                        <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>Doğrulandı</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-red-700 max-w-[240px]" title={proxy.errorMessage}>
                          <XCircle className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{proxy.errorMessage || 'Başarısız'}</span>
                        </span>
                      )}
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
