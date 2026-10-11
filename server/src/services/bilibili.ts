import crypto from 'node:crypto';
import type { SearchResult } from '../types.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

interface BilibiliSearchResponse {
  code: number;
  data?: {
    result?: Array<{
      aid: number;
      bvid: string;
      title: string;
      description: string;
      author: string;
      mid: number;
      play: number;
      review: number;
      danmaku: number;
      like: number;
      pubdate: number;
    }>;
  };
}

/**
 * Bilibili 视频搜索（公开 API，无需 Key）。
 * order=totalrank 综合排序（平台热度权重），确保召回的是热门内容而非刚发布的冷门视频；
 * 随机生成 buvid3 cookie 规避 412 风控。
 */
export async function searchBilibili(query: string): Promise<SearchResult[]> {
  const waitMs = Math.max(0, 2000 - (Date.now() % 2000));
  await new Promise(resolve => setTimeout(resolve, waitMs));

  try {
    const params = new URLSearchParams({
      keyword: query,
      search_type: 'video',
      order: 'totalrank',
      page: '1',
      pagesize: '20'
    });

    const res = await fetch(`https://api.bilibili.com/x/web-interface/search/type?${params}`, {
      headers: {
        'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        'Referer': 'https://search.bilibili.com/',
        'Accept': 'application/json',
        'Cookie': `buvid3=${crypto.randomUUID()}infoc`
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error(`Bilibili API ${res.status}`);

    const data = await res.json() as BilibiliSearchResponse;
    if (data.code !== 0 || !data.data?.result) {
      console.log(`Bilibili search: no results or API error (code: ${data.code})`);
      return [];
    }

    const results: SearchResult[] = data.data.result.map(video => ({
      title: video.title.replace(/<\/?em[^>]*>/g, ''),
      content: video.description || video.title.replace(/<\/?em[^>]*>/g, ''),
      url: `https://www.bilibili.com/video/${video.bvid}`,
      source: 'bilibili' as const,
      sourceId: video.bvid,
      publishedAt: new Date(video.pubdate * 1000),
      viewCount: video.play,
      likeCount: video.like,
      commentCount: video.review,
      danmakuCount: video.danmaku,
      author: { name: video.author, username: String(video.mid) }
    }));

    console.log(`Bilibili search for "${query}": found ${results.length} results`);
    return results;
  } catch (error) {
    console.error('Bilibili search error:', error instanceof Error ? error.message : error);
    return [];
  }
}
