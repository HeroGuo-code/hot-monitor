const API_BASE = '/api';

export interface Keyword {
  id: string;
  text: string;
  category: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  hotspotCount: number;
}

export interface Hotspot {
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

export interface HotspotListResponse {
  data: Hotspot[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface Stats {
  total: number;
  today: number;
  urgent: number;
  bySource: Record<string, number>;
}

export interface ServerStatus {
  running: boolean;
  lastRunAt: string | null;
  lastRunFound: number;
  lastError: string | null;
  activeKeywords: number;
  aiEnabled: boolean;
}

export interface SearchAnalysis {
  isReal: boolean;
  relevance: number;
  relevanceReason: string;
  keywordMentioned: boolean;
  importance: string;
  summary: string;
  brief?: string | null;
}

export interface SearchItem {
  title: string;
  content: string;
  url: string;
  source: string;
  sourceId?: string;
  publishedAt: string | null;
  viewCount?: number | null;
  likeCount?: number | null;
  commentCount?: number | null;
  danmakuCount?: number | null;
  author?: { name: string; username?: string };
  analysis: SearchAnalysis | null;
}

export interface HotspotQuery {
  page?: number;
  limit?: number;
  source?: string;
  importance?: string;
  keywordId?: string;
  timeRange?: string;
  sortBy?: string;
  sortOrder?: string;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

// Keywords API
export const keywordsApi = {
  getAll: () => request<Keyword[]>('/keywords'),

  create: (data: { text: string; category?: string }) =>
    request<Keyword>('/keywords', { method: 'POST', body: JSON.stringify(data) }),

  update: (id: string, data: Partial<Keyword>) =>
    request<Keyword>(`/keywords/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  delete: (id: string) =>
    request<void>(`/keywords/${id}`, { method: 'DELETE' }),

  toggle: (id: string) =>
    request<Keyword>(`/keywords/${id}/toggle`, { method: 'PATCH' })
};

// Hotspots API
export const hotspotsApi = {
  getAll: (params?: HotspotQuery) => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== '') searchParams.append(key, String(value));
      });
    }
    return request<HotspotListResponse>(`/hotspots?${searchParams}`);
  },

  getStats: () => request<Stats>('/hotspots/stats'),

  search: (query: string, sources?: string[]) =>
    request<{ results: SearchItem[] }>('/hotspots/search', {
      method: 'POST',
      body: JSON.stringify({ query, sources })
    }),

  delete: (id: string) =>
    request<void>(`/hotspots/${id}`, { method: 'DELETE' })
};

// 服务状态与手动触发
export const getServerStatus = () => request<ServerStatus>('/status');
export const triggerHotspotCheck = () =>
  request<{ message: string }>('/check-hotspots', { method: 'POST' });
