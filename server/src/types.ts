export type SourceName = 'hackernews' | 'bing' | 'bilibili';

export interface SearchResult {
  title: string;
  content: string;
  url: string;
  source: SourceName;
  sourceId?: string;
  publishedAt?: Date;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  danmakuCount?: number;
  author?: {
    name: string;
    username?: string;
  };
}

export interface AIAnalysis {
  isReal: boolean;
  relevance: number;
  relevanceReason: string;
  keywordMentioned: boolean;
  importance: 'low' | 'medium' | 'high' | 'urgent';
  summary: string;
  /** 50 字左右的热点简介：说清楚发生了什么 */
  brief: string;
}

/** 数据库热点原始行（布尔值为 0/1 存储） */
export interface HotspotRow {
  id: string;
  title: string;
  content: string;
  url: string;
  source: string;
  isReal: number;
  relevance: number;
  relevanceReason: string | null;
  keywordMentioned: number | null;
  importance: string;
  summary: string | null;
  brief: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  danmakuCount: number | null;
  authorName: string | null;
  publishedAt: string | null;
  keywordId: string | null;
  keywordText: string | null;
  createdAt: string;
}

/** 序列化后返回给前端的热点对象 */
export interface HotspotDTO {
  id: string;
  title: string;
  content: string;
  url: string;
  source: string;
  isReal: boolean;
  relevance: number;
  relevanceReason: string | null;
  keywordMentioned: boolean | null;
  importance: string;
  summary: string | null;
  brief: string | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  danmakuCount: number | null;
  authorName: string | null;
  publishedAt: string | null;
  keywordId: string | null;
  keyword: { id: string; text: string } | null;
  createdAt: string;
}
