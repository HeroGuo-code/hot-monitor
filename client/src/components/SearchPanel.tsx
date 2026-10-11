import { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { hotspotsApi, type SearchItem } from '../services/api';
import HotspotCard from './HotspotCard';

const SOURCE_OPTIONS = [
  { value: 'bing', label: 'Bing' },
  { value: 'hackernews', label: 'HackerNews' },
  { value: 'bilibili', label: 'B站' }
];

/** 全网搜索：聚合多源 + AI 相关性分析（不入库） */
export default function SearchPanel({ onError }: { onError: (message: string) => void }) {
  const [query, setQuery] = useState('');
  const [sources, setSources] = useState<string[]>(SOURCE_OPTIONS.map(o => o.value));
  const [results, setResults] = useState<SearchItem[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggleSource = (value: string) => {
    setSources(prev => prev.includes(value) ? prev.filter(s => s !== value) : [...prev, value]);
  };

  const handleSearch = async () => {
    const value = query.trim();
    if (!value || loading) return;
    setLoading(true);
    try {
      const { results: items } = await hotspotsApi.search(value, sources);
      setResults(items);
    } catch (error) {
      onError(error instanceof Error ? error.message : '搜索失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="card p-5">
        <div className="flex items-center gap-2">
          <input
            className="input flex-1"
            placeholder="输入关键词全网聚合搜索，如 Agent 框架对比"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
          />
          <button className="btn-primary" onClick={handleSearch} disabled={!query.trim() || loading}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            搜索
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          <span>搜索来源：</span>
          {SOURCE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => toggleSource(opt.value)}
              className={`chip border transition ${
                sources.includes(opt.value)
                  ? 'border-blue-200 bg-blue-50 text-blue-600'
                  : 'border-slate-200 bg-white text-slate-400'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {results && (
        results.length === 0 ? (
          <p className="card px-4 py-10 text-center text-sm text-slate-400">没有找到相关内容</p>
        ) : (
          <div className="space-y-3">
            {results.map(item => (
              <HotspotCard key={item.url} item={item} showContent />
            ))}
          </div>
        )
      )}
    </section>
  );
}
