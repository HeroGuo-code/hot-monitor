import * as cheerio from 'cheerio';
import type { SearchResult } from '../types.js';

// User Agent 列表
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/** 带超时与 UA 的 GET 请求，返回文本 */
export async function httpGetText(url: string, headers: Record<string, string> = {}, timeoutMs = 15000): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept-Language': 'en-US,en;q=0.5',
      ...headers
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

// 频率限制器
class RateLimiter {
  private lastRequestTime = 0;
  constructor(private minIntervalMs: number = 5000) {}

  async wait(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < this.minIntervalMs) {
      await new Promise(resolve => setTimeout(resolve, this.minIntervalMs - elapsed));
    }
    this.lastRequestTime = Date.now();
  }
}

const bingLimiter = new RateLimiter(5000);
const hackernewsLimiter = new RateLimiter(1000); // HN API 更宽松

// ============================================================
// Bing 搜索（HTML 解析，无需 API Key）
// ============================================================
export async function searchBing(query: string): Promise<SearchResult[]> {
  await bingLimiter.wait();

  try {
    const html = await httpGetText('https://www.bing.com/search?q=' + encodeURIComponent(query) + '&count=20', {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    });

    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    $('li.b_algo').each((_, element) => {
      const titleElement = $(element).find('h2 a');
      const title = titleElement.text().trim();
      const url = titleElement.attr('href');
      const snippet = $(element).find('.b_caption p').text().trim();

      if (title && url && url.startsWith('http')) {
        results.push({ title, content: snippet, url, source: 'bing' });
      }
    });

    console.log(`Bing search for "${query}": found ${results.length} results`);
    return results;
  } catch (error) {
    console.error('Bing search error:', error instanceof Error ? error.message : error);
    return [];
  }
}

// ============================================================
// Hacker News 官方 API（最稳定的数据源）
// ============================================================
interface HNSearchResult {
  hits: Array<{
    objectID: string;
    title: string;
    url: string | null;
    story_text: string | null;
    author: string;
    points: number;
    num_comments: number;
    created_at: string;
  }>;
}

export async function searchHackerNews(query: string): Promise<SearchResult[]> {
  await hackernewsLimiter.wait();

  try {
    // 7 天窗口 + 30 分门槛：/search 端点按相关性与人气加权，拿"近期热门"而非"最新发布"
    const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 3600 * 1000) / 1000);
    const params = new URLSearchParams({
      query,
      tags: 'story',
      hitsPerPage: '20',
      numericFilters: `created_at_i>${sevenDaysAgo},points>30`
    });
    const res = await fetch(`https://hn.algolia.com/api/v1/search?${params}`, {
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error(`HN API ${res.status}`);

    const data = await res.json() as HNSearchResult;
    const results: SearchResult[] = data.hits
      .filter(hit => hit.url || hit.story_text)
      .map(hit => ({
        title: hit.title,
        content: hit.story_text || hit.title,
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        source: 'hackernews' as const,
        sourceId: hit.objectID,
        publishedAt: new Date(hit.created_at),
        likeCount: hit.points,
        commentCount: hit.num_comments,
        author: { name: hit.author, username: hit.author }
      }));

    console.log(`Hacker News search for "${query}": found ${results.length} results`);
    return results;
  } catch (error) {
    console.error('Hacker News search error:', error instanceof Error ? error.message : error);
    return [];
  }
}

// ============================================================
// 去重与聚合
// ============================================================
export function deduplicateResults(allResults: SearchResult[]): SearchResult[] {
  const uniqueUrls = new Set<string>();
  return allResults.filter(item => {
    const normalizedUrl = item.url.replace(/\/$/, '').replace(/^https?:\/\/www\./, 'https://');
    if (uniqueUrls.has(normalizedUrl)) return false;
    uniqueUrls.add(normalizedUrl);
    return true;
  });
}

/** 全网搜索（手动搜索用）：聚合所有可用数据源 */
export async function searchAll(query: string, sources: string[] = ['bing', 'hackernews', 'bilibili']): Promise<SearchResult[]> {
  const tasks: Promise<SearchResult[]>[] = [];
  const names: string[] = [];

  if (sources.includes('bing')) { tasks.push(searchBing(query)); names.push('Bing'); }
  if (sources.includes('hackernews')) { tasks.push(searchHackerNews(query)); names.push('HackerNews'); }
  if (sources.includes('bilibili')) {
    const { searchBilibili } = await import('./bilibili.js');
    tasks.push(searchBilibili(query));
    names.push('Bilibili');
  }

  const settled = await Promise.allSettled(tasks);
  const allResults: SearchResult[] = [];
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') allResults.push(...result.value);
    else console.warn(`${names[i]} search failed:`, result.reason);
  });

  const uniqueResults = deduplicateResults(allResults);
  console.log(`Search aggregation for "${query}": ${allResults.length} total, ${uniqueResults.length} unique`);
  return uniqueResults;
}
