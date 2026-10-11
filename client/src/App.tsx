import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, CheckCircle2, ChevronLeft, ChevronRight, Flame,
  Loader2, Radio, RefreshCw, Search, Wifi, WifiOff, X, Zap, AlertTriangle, Layers
} from 'lucide-react';
import {
  hotspotsApi, keywordsApi, getServerStatus, triggerHotspotCheck,
  type Hotspot, type HotspotQuery, type Keyword, type Stats, type ServerStatus
} from './services/api';
import { connectEvents } from './services/sse';
import KeywordManager from './components/KeywordManager';
import FilterBar from './components/FilterBar';
import HotspotCard from './components/HotspotCard';
import SearchPanel from './components/SearchPanel';

type Tab = 'monitor' | 'search';

const DEFAULT_FILTERS: HotspotQuery = { page: 1, limit: 20, sortBy: 'hot', sortOrder: 'desc' };

export default function App() {
  const [tab, setTab] = useState<Tab>('monitor');
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [filters, setFilters] = useState<HotspotQuery>(DEFAULT_FILTERS);
  const [stats, setStats] = useState<Stats | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: 'info' | 'success' | 'error'; message: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: 'info' | 'success' | 'error', message: string) => {
    setToast({ type, message });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // ===== 数据加载 =====

  const loadKeywords = useCallback(async () => {
    try { setKeywords(await keywordsApi.getAll()); }
    catch (error) { showToast('error', error instanceof Error ? error.message : '加载关键词失败'); }
  }, [showToast]);

  const loadStatsAndStatus = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([hotspotsApi.getStats(), getServerStatus()]);
      setStats(s); setStatus(st);
    } catch { /* 状态栏静默失败 */ }
  }, []);

  const loadHotspots = useCallback(async (query: HotspotQuery) => {
    setLoading(true);
    try {
      const res = await hotspotsApi.getAll(query);
      setHotspots(res.data);
      setPagination({ page: res.pagination.page, total: res.pagination.total, totalPages: res.pagination.totalPages });
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '加载热点失败');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void loadKeywords(); void loadStatsAndStatus(); }, [loadKeywords, loadStatsAndStatus]);
  useEffect(() => { void loadHotspots(filters); }, [filters, loadHotspots]);

  // ===== SSE 实时推送 =====

  useEffect(() => {
    const disconnect = connectEvents({
      onConnected: setConnected,
      onHotspot: hotspot => {
        showToast('success', `发现新热点：${hotspot.title.slice(0, 40)}`);
        // 仅当在第一页且无筛选时直接插入，否则提示刷新
        if (filters.page === 1 && !filters.source && !filters.importance && !filters.keywordId && !filters.timeRange) {
          setHotspots(prev => [hotspot, ...prev.filter(h => h.id !== hotspot.id)].slice(0, filters.limit ?? 20));
          setPagination(p => ({ ...p, total: p.total + 1 }));
        }
        void loadStatsAndStatus();
      },
      onCheckDone: ({ found }) => {
        showToast('info', `本轮抓取完成，新增 ${found} 条热点`);
        void loadStatsAndStatus();
        void loadHotspots(filters);
      },
      onCheckError: ({ message }) => showToast('error', `抓取失败：${message}`)
    });
    return disconnect;
    // filters 通过 ref 语义在这里保持最新即可——filters 变化会重连一次，代价可忽略
  }, [filters, showToast, loadStatsAndStatus, loadHotspots]);

  // 状态轮询（抓取中时 5s 一次）
  useEffect(() => {
    if (!status?.running) return;
    const timer = setInterval(() => void loadStatsAndStatus(), 5000);
    return () => clearInterval(timer);
  }, [status?.running, loadStatsAndStatus]);

  // ===== 操作 =====

  const handleTrigger = async () => {
    try {
      await triggerHotspotCheck();
      showToast('info', '抓取任务已启动');
      void loadStatsAndStatus();
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '触发失败');
    }
  };

  const handleRefreshKeywords = () => {
    void loadKeywords();
    void loadStatsAndStatus();
  };

  const handleDeleteHotspot = async (id: string) => {
    try {
      await hotspotsApi.delete(id);
      setHotspots(prev => prev.filter(h => h.id !== id));
      void loadStatsAndStatus();
    } catch (error) {
      showToast('error', error instanceof Error ? error.message : '删除失败');
    }
  };

  const statCards = [
    { label: '累计热点', value: stats?.total ?? '-', icon: Layers, cls: 'text-blue-600 bg-blue-50' },
    { label: '今日新增', value: stats?.today ?? '-', icon: Zap, cls: 'text-amber-600 bg-amber-50' },
    { label: '重要热点', value: stats?.urgent ?? '-', icon: AlertTriangle, cls: 'text-red-500 bg-red-50' },
    { label: '数据来源', value: stats ? Object.keys(stats.bySource).length : '-', icon: Activity, cls: 'text-emerald-600 bg-emerald-50' }
  ];

  return (
    <div className="min-h-screen">
      {/* Hero 头部 */}
      <header className="border-b border-slate-200/70 bg-gradient-to-b from-blue-50/80 via-white to-white">
        <div className="mx-auto max-w-5xl px-6 pb-8 pt-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
                <Flame size={22} />
              </span>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-slate-900">AI 热点监控</h1>
                <p className="text-[13px] text-slate-500">多源聚合抓取 · AI 相关性分析 · 实时推送</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`chip border ${connected ? 'border-emerald-100 bg-emerald-50 text-emerald-600' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
                {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
                {connected ? '实时连接' : '未连接'}
              </span>
              <button className="btn-ghost" onClick={handleRefreshKeywords} title="刷新数据">
                <RefreshCw size={14} />
              </button>
              <button className="btn-primary" onClick={handleTrigger} disabled={status?.running}>
                {status?.running ? <Loader2 size={15} className="animate-spin" /> : <Radio size={15} />}
                {status?.running ? '抓取中…' : '立即抓取'}
              </button>
            </div>
          </div>

          {/* 统计卡片 */}
          <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {statCards.map(({ label, value, icon: Icon, cls }) => (
              <div key={label} className="card flex items-center gap-3 px-4 py-3.5">
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${cls}`}>
                  <Icon size={17} />
                </span>
                <div>
                  <div className="stat-value">{value}</div>
                  <div className="text-xs text-slate-400">{label}</div>
                </div>
              </div>
            ))}
          </div>

          {status?.lastRunAt && (
            <p className="mt-3 text-xs text-slate-400">
              上次抓取：{new Date(status.lastRunAt).toLocaleString('zh-CN')}
              {status.lastRunFound > 0 && `，新增 ${status.lastRunFound} 条`}
              {status.lastError && <span className="text-red-400">（上次异常：{status.lastError}）</span>}
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-6">
        {/* Tab 切换 */}
        <div className="mb-5 inline-flex rounded-xl border border-slate-200 bg-white p-1">
          {([
            { key: 'monitor', label: '监控看板', icon: Flame },
            { key: 'search', label: '全网搜索', icon: Search }
          ] as const).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                tab === key ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {tab === 'monitor' ? (
          <div className="space-y-5">
            <KeywordManager keywords={keywords} onChanged={handleRefreshKeywords} onError={msg => showToast('error', msg)} />
            <FilterBar filters={filters} keywords={keywords} onChange={setFilters} />

            {loading ? (
              <div className="card flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
                <Loader2 size={16} className="animate-spin" />
                加载中…
              </div>
            ) : hotspots.length === 0 ? (
              <div className="card px-4 py-16 text-center text-sm text-slate-400">
                暂无热点数据，添加关键词后点击「立即抓取」试试
              </div>
            ) : (
              <div className="space-y-3">
                {hotspots.map(hotspot => (
                  <HotspotCard key={hotspot.id} item={hotspot} onDelete={handleDeleteHotspot} />
                ))}
              </div>
            )}

            {/* 分页 */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-2 text-sm text-slate-500">
                <button
                  className="btn-ghost !px-3 !py-1.5"
                  disabled={pagination.page <= 1}
                  onClick={() => setFilters(f => ({ ...f, page: (f.page ?? 1) - 1 }))}
                >
                  <ChevronLeft size={14} /> 上一页
                </button>
                <span>第 {pagination.page} / {pagination.totalPages} 页 · 共 {pagination.total} 条</span>
                <button
                  className="btn-ghost !px-3 !py-1.5"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setFilters(f => ({ ...f, page: (f.page ?? 1) + 1 }))}
                >
                  下一页 <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        ) : (
          <SearchPanel onError={msg => showToast('error', msg)} />
        )}
      </main>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-lg shadow-slate-900/5">
          {toast.type === 'success' && <CheckCircle2 size={15} className="text-emerald-500" />}
          {toast.type === 'error' && <AlertTriangle size={15} className="text-red-500" />}
          {toast.type === 'info' && <Activity size={15} className="text-blue-500" />}
          <span className="max-w-sm text-slate-700">{toast.message}</span>
          <button className="btn-icon ml-1" onClick={() => setToast(null)}>
            <X size={13} />
          </button>
        </div>
      )}

      <footer className="border-t border-slate-200/70 py-6 text-center text-xs text-slate-300">
        AI Hotspot Monitor Lite · Express + SQLite + SSE + OpenRouter
      </footer>
    </div>
  );
}
