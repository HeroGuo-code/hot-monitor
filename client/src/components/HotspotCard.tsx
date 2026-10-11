import { ExternalLink, Globe, MessageCircle, MonitorPlay, Newspaper, ThumbsUp, Trash2, Eye, Sparkles } from 'lucide-react';
import { relativeTime, formatDateTime } from '../utils/relativeTime';
import type { SearchAnalysis } from '../services/api';

export const SOURCE_META: Record<string, { label: string; cls: string; icon: typeof Globe }> = {
  hackernews: { label: 'HackerNews', cls: 'bg-orange-50 text-orange-600', icon: Newspaper },
  bilibili: { label: 'B站', cls: 'bg-pink-50 text-pink-600', icon: MonitorPlay },
  bing: { label: 'Bing', cls: 'bg-sky-50 text-sky-600', icon: Globe }
};

const IMPORTANCE_META: Record<string, { label: string; cls: string }> = {
  urgent: { label: '紧急', cls: 'bg-red-50 text-red-600 border-red-100' },
  high: { label: '重要', cls: 'bg-amber-50 text-amber-600 border-amber-100' },
  medium: { label: '一般', cls: 'bg-blue-50 text-blue-600 border-blue-100' },
  low: { label: '次要', cls: 'bg-slate-100 text-slate-500 border-slate-200' }
};

interface CardData {
  id?: string;
  title: string;
  content?: string;
  url: string;
  source: string;
  importance?: string;
  relevance?: number;
  summary?: string | null;
  brief?: string | null;
  relevanceReason?: string | null;
  likeCount?: number | null;
  viewCount?: number | null;
  commentCount?: number | null;
  danmakuCount?: number | null;
  authorName?: string | null;
  publishedAt?: string | null;
  createdAt?: string;
  keyword?: { id: string; text: string } | null;
  analysis?: SearchAnalysis | null;
}

/** 热点卡片：监控流与全网搜索结果共用 */
export default function HotspotCard({
  item,
  showContent = false,
  onDelete
}: {
  item: CardData;
  showContent?: boolean;
  onDelete?: (id: string) => void;
}) {
  const source = SOURCE_META[item.source] ?? SOURCE_META.bing;
  const SourceIcon = source.icon;
  const importance = (item.analysis?.importance ?? item.importance ?? 'low').toLowerCase();
  const importanceMeta = IMPORTANCE_META[importance] ?? IMPORTANCE_META.low;
  const relevance = item.analysis?.relevance ?? item.relevance ?? null;
  // AI 生成的 50 字简介优先，旧数据的 summary 作为回退
  const summary = item.brief ?? item.analysis?.brief ?? item.analysis?.summary ?? item.summary;
  const reason = item.analysis?.relevanceReason ?? item.relevanceReason;
  const time = relativeTime(item.publishedAt ?? item.createdAt);
  const metrics = [
    item.likeCount != null && item.likeCount > 0 ? { icon: ThumbsUp, value: item.likeCount } : null,
    item.viewCount != null && item.viewCount > 0 ? { icon: Eye, value: item.viewCount } : null,
    item.commentCount != null && item.commentCount > 0 ? { icon: MessageCircle, value: item.commentCount } : null,
    item.danmakuCount != null && item.danmakuCount > 0 ? { icon: Sparkles, value: item.danmakuCount } : null
  ].filter(Boolean) as Array<{ icon: typeof ThumbsUp; value: number }>;

  return (
    <article className="card card-hover group p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`chip ${source.cls}`}>
            <SourceIcon size={12} />
            {source.label}
          </span>
          <span className={`chip border ${importanceMeta.cls}`}>{importanceMeta.label}</span>
          {item.keyword && (
            <span className="chip bg-blue-50 text-blue-600">#{item.keyword.text}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onDelete && item.id && (
            <button
              title="删除"
              onClick={() => onDelete(item.id as string)}
              className="btn-icon opacity-0 transition group-hover:opacity-100 hover:!text-red-500"
            >
              <Trash2 size={14} />
            </button>
          )}
          <a href={item.url} target="_blank" rel="noreferrer" title="查看原文" className="btn-icon">
            <ExternalLink size={14} />
          </a>
        </div>
      </div>

      <h3 className="mt-3 text-[15px] font-semibold leading-snug text-slate-900">
        <a href={item.url} target="_blank" rel="noreferrer" className="transition hover:text-blue-600">
          {item.title}
        </a>
      </h3>

      {showContent && item.content && (
        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-slate-500">{item.content}</p>
      )}

      {summary && (
        <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-blue-50/60 px-3 py-2 text-[13px] leading-relaxed text-blue-900/80">
          <Sparkles size={13} className="mt-1 shrink-0 text-blue-500" />
          {summary}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-400">
        {relevance != null && (
          <span className="flex items-center gap-1.5">
            <span>相关度</span>
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
              <span
                className="block h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${relevance}%` }}
              />
            </span>
            <span className="font-medium text-slate-600">{relevance}</span>
          </span>
        )}
        {reason && (
          <span className="max-w-xs truncate" title={reason}>{reason}</span>
        )}
        {metrics.map(({ icon: Icon, value }, i) => (
          <span key={i} className="flex items-center gap-1">
            <Icon size={12} />
            {value > 1000 ? `${(value / 1000).toFixed(1)}k` : value}
          </span>
        ))}
        {item.authorName && <span>@{item.authorName}</span>}
        {time && (
          <span title={formatDateTime(item.publishedAt ?? item.createdAt)}>{time}</span>
        )}
      </div>
    </article>
  );
}
