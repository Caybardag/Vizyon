import { Activity, Globe2, History, Menu, ShieldCheck, X } from 'lucide-react';

export type ActiveTab = 'orchestrator' | 'proxies' | 'history';

interface SidebarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  verifiedUniqueCount: number;
  targetIpCount: number;
  harvestRunning: boolean;
  runsCount: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  activeTab,
  onSelectTab,
  verifiedUniqueCount,
  targetIpCount,
  harvestRunning,
  runsCount,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const navItems: Array<{
    id: ActiveTab;
    label: string;
    icon: typeof Activity;
    meta: string | null;
  }> = [
    {
      id: 'orchestrator',
      label: 'Görev Orkestratörü',
      icon: Activity,
      meta: null,
    },
    {
      id: 'proxies',
      label: 'IP & Oturum Havuzu',
      icon: Globe2,
      meta: `${verifiedUniqueCount} IP`,
    },
    {
      id: 'history',
      label: 'Doğrulama Geçmişi',
      icon: History,
      meta: `${runsCount}`,
    },
  ];

  const readinessPercent = Math.min(100, Math.round((verifiedUniqueCount / targetIpCount) * 100));

  const content = (
    <div className="flex h-full flex-col justify-between bg-white border-r border-slate-200">
      <div>
        <div className="flex items-center justify-between h-14 px-5 border-b border-slate-200">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            NexusIP
          </span>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Menüyü kapat"
            className="lg:hidden p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav aria-label="Ana menü" className="p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectTab(item.id);
                  onCloseMobile();
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.meta !== null && (
                  <span
                    className={`font-mono text-xs tabular-nums shrink-0 ${
                      isActive ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    {item.meta}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="p-4 border-t border-slate-200 space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span className="font-medium flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
            <span>30+ IP Hazırlığı</span>
          </span>
          <span className="font-mono font-semibold text-slate-900 tabular-nums">
            {verifiedUniqueCount}/{targetIpCount}
          </span>
        </div>
        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              verifiedUniqueCount >= targetIpCount ? 'bg-emerald-600' : 'bg-blue-600'
            }`}
            style={{ width: `${readinessPercent}%` }}
          />
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          {harvestRunning
            ? 'Açık kaynak proxy kaynakları canlı doğrulanıyor.'
            : verifiedUniqueCount >= targetIpCount
            ? 'En az 30 benzersiz çıkış IP’si çoklu oturuma hazır.'
            : 'Gerçek çoklu IP için havuz taramasını çalıştırın.'}
        </p>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-[272px] shrink-0 h-screen sticky top-0">{content}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative w-72 max-w-[85vw] h-full z-10">{content}</aside>
        </div>
      )}
    </>
  );
}

export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Menüyü aç"
      className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100"
    >
      <Menu className="w-5 h-5" />
    </button>
  );
}
