import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react';
import type { Keyword, HotspotQuery } from '../services/api';

interface Props {
  filters: HotspotQuery;
  keywords: Keyword[];
  onChange: (filters: HotspotQuery) => void;
}

const SORT_OPTIONS = [
  { value: 'createdAt', label: '发现时间' },
  { value: 'publishedAt', label: '发布时间' },
  { value: 'relevance', label: '相关度' },
  { value: 'importance', label: '重要程度' },
  { value: 'hot', label: '热度' }
];

/** 热点流筛选与排序栏 */
export default function FilterBar({ filters, keywords, onChange }: Props) {
  const set = (patch: Partial<HotspotQuery>) => onChange({ ...filters, page: 1, ...patch });

  const selectCls = 'input !py-1.5 !text-[13px] cursor-pointer';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className={selectCls} value={filters.source ?? ''} onChange={e => set({ source: e.target.value })}>
        <option value="">全部来源</option>
        <option value="hackernews">HackerNews</option>
        <option value="bilibili">B站</option>
        <option value="bing">Bing</option>
      </select>

      <select className={selectCls} value={filters.importance ?? ''} onChange={e => set({ importance: e.target.value })}>
        <option value="">全部级别</option>
        <option value="urgent">紧急</option>
        <option value="high">重要</option>
        <option value="medium">一般</option>
        <option value="low">次要</option>
      </select>

      <select className={selectCls} value={filters.keywordId ?? ''} onChange={e => set({ keywordId: e.target.value })}>
        <option value="">全部关键词</option>
        {keywords.map(kw => (
          <option key={kw.id} value={kw.id}>{kw.text}</option>
        ))}
      </select>

      <select className={selectCls} value={filters.timeRange ?? ''} onChange={e => set({ timeRange: e.target.value })}>
        <option value="">全部时间</option>
        <option value="1h">近 1 小时</option>
        <option value="today">今天</option>
        <option value="7d">近 7 天</option>
        <option value="30d">近 30 天</option>
      </select>

      <div className="flex items-center gap-1.5">
        <select className={selectCls} value={filters.sortBy ?? 'hot'} onChange={e => set({ sortBy: e.target.value })}>
          {SORT_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <button
          className="btn-icon border border-slate-200 bg-white"
          title={filters.sortOrder === 'asc' ? '升序' : '降序'}
          onClick={() => set({ sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc' })}
        >
          {filters.sortOrder === 'asc' ? <ArrowUpNarrowWide size={14} /> : <ArrowDownWideNarrow size={14} />}
        </button>
      </div>
    </div>
  );
}
