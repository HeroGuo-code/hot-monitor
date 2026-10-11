import {
  listKeywords, getHotspotByUrl, insertHotspot, cleanupOldHotspots,
  getRecentTitles, getDailyKeywordStats, deleteHotspot, type HotspotDTO
} from '../db.js';
import { searchBing, searchHackerNews, deduplicateResults } from '../services/search.js';
import { searchBilibili } from '../services/bilibili.js';
import { analyzeContent, expandKeyword, preMatchKeyword, batchPrefilter, type PrefilterCandidate } from '../services/ai.js';
import { config } from '../config.js';
import type { SearchResult } from '../types.js';

/** 抓取任务运行状态（供 /api/status 与前端状态展示） */
export interface CheckerStatus {
  running: boolean;
  lastRunAt: string | null;
  lastRunFound: number;
  lastError: string | null;
}

export const checkerStatus: CheckerStatus = {
  running: false,
  lastRunAt: null,
  lastRunFound: 0,
  lastError: null
};

// ========== 标题相似度（跨源/跨轮判重，同事件多篇报道只收一条） ==========

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function bigrams(text: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2));
  return set;
}

function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb || na.includes(nb) || nb.includes(na)) return 1;
  const ba = bigrams(na);
  const bb = bigrams(nb);
  if (ba.size === 0 || bb.size === 0) return 0;
  let inter = 0;
  for (const g of ba) if (bb.has(g)) inter++;
  return inter / (ba.size + bb.size - inter);
}

// ========== 热度预筛（互动信号规则，零 AI 成本） ==========

function formatEngagement(item: SearchResult): string {
  const parts: string[] = [];
  if (item.likeCount) parts.push(`赞${item.likeCount}`);
  if (item.commentCount) parts.push(`评论${item.commentCount}`);
  if (item.viewCount) parts.push(`播放${item.viewCount}`);
  if (item.danmakuCount) parts.push(`弹幕${item.danmakuCount}`);
  return parts.join('/') || '无互动数据';
}

/** 按来源规则过滤低互动内容；无互动信号的内容放行，交给 AI 粗筛把关 */
function prefilterByEngagement(results: SearchResult[]): SearchResult[] {
  return results.filter(item => {
    switch (item.source) {
      case 'hackernews': {
        const points = item.likeCount ?? 0;
        const comments = item.commentCount ?? 0;
        if (points === 0 && comments === 0) return true; // 无信号放行
        return points >= config.hnPointsMin || comments >= config.hnCommentsMin;
      }
      case 'bilibili': {
        const views = item.viewCount ?? 0;
        // B站 API 必返回播放量：0 播放 = 刚发布无流量，直接拦截
        if (views === 0) return false;
        if (views >= config.biliViewMin) return true;
        // 爆发率：播放量 / 发布小时数，热点看速度不看总量
        if (item.publishedAt) {
          const hours = Math.max(1, (Date.now() - item.publishedAt.getTime()) / 3600_000);
          return views / hours >= config.biliVelocityMin;
        }
        return false;
      }
      default:
        return true;
    }
  });
}

/** 从快照文本开头解析发布日期（Bing 无结构化日期时的兜底，无法解析返回 null） */
export function parseSnippetDate(text: string): Date | null {
  if (!text) return null;
  const head = text.slice(0, 60);
  const now = new Date();

  // 相对时间：X minutes/hours/days ago、X分钟/小时/天前、昨天/yesterday
  const rel = head.match(/(\d+)\s*(minute|hour|day|分钟|小时|天)[s]?\s*(?:前|ago)/i);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const ms = unit.startsWith('minute') || unit === '分钟' ? 60_000
      : unit.startsWith('hour') || unit === '小时' ? 3_600_000 : 86_400_000;
    return new Date(now.getTime() - n * ms);
  }
  if (/yesterday|昨天/i.test(head)) return new Date(now.getTime() - 86_400_000);

  // 绝对日期：2026-06-17 / 2026年6月17日
  const iso = head.match(/(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  // 绝对日期：Jun 17, 2026 / Oct 29, 2025
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const en = head.match(/([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})/i);
  if (en) {
    const m = months.indexOf(en[1].toLowerCase());
    if (m >= 0) return new Date(Number(en[3]), m, Number(en[2]));
  }
  return null;
}

/** 新鲜度过滤：热点时效性内才保留；无结构化日期时尝试从快照解析，仍无法判定则放行交给 AI 把关 */
function filterByFreshness(results: SearchResult[]): SearchResult[] {
  const cutoff = new Date(Date.now() - config.maxAgeHours * 3600 * 1000);
  return results.filter(item => {
    const date = item.publishedAt ?? parseSnippetDate(item.content);
    if (!date) return true;
    if (date < cutoff) {
      console.log(`  ⏰ Too old (>15d): ${item.title.slice(0, 30)}...`);
      return false;
    }
    return true;
  });
}

/** 按来源优先级排序：HackerNews > B站 > Bing */
function prioritizeResults(results: SearchResult[]): SearchResult[] {
  const priorityMap: Record<string, number> = { hackernews: 1, bilibili: 2, bing: 3 };
  return [...results].sort((a, b) => (priorityMap[a.source] || 99) - (priorityMap[b.source] || 99));
}

/**
 * 执行一轮热点抓取（漏斗式：召回 → 判重 → 热度预筛 → AI 粗筛 → AI 细评 → Top N 入库）。
 * - 互斥锁：手动触发与定时任务重叠时直接跳过
 * - 标题相似度判重：同一事件跨源/跨轮只收一条
 * - 每日 Top N：同关键词当日超过上限时，高分新热点挤掉当日最低分
 */
export async function runHotspotCheck(onNewHotspot: (hotspot: HotspotDTO) => void): Promise<{ found: number; skipped: boolean }> {
  if (checkerStatus.running) {
    console.log('⏭ Hotspot check already running, skipped');
    return { found: 0, skipped: true };
  }

  checkerStatus.running = true;
  checkerStatus.lastError = null;
  let newHotspotsCount = 0;

  try {
    const keywords = listKeywords().filter(k => k.isActive);
    if (keywords.length === 0) {
      console.log('No active keywords to monitor');
      checkerStatus.lastRunAt = new Date().toISOString();
      checkerStatus.lastRunFound = 0;
      return { found: 0, skipped: false };
    }

    console.log(`🔍 Starting hotspot check for ${keywords.length} keywords...`);

    for (const keyword of keywords) {
      console.log(`\n📎 Checking keyword: "${keyword.text}"`);

      try {
        // 1. 查询扩展（有缓存）
        const expandedKeywords = await expandKeyword(keyword.text);
        const englishVariants = expandedKeywords
          .filter(v => /^[\x20-\x7E]+$/.test(v) && /[a-zA-Z]{3,}/.test(v))
          .slice(0, 2);
        console.log(`  🔍 Variants(${expandedKeywords.length}): ${expandedKeywords.slice(0, 8).join(' | ')} → HN用: ${englishVariants.join(', ') || '(无)'}`);

        // 2. 多源并行抓取（Bing 无互动信号，只取前几条作补充）
        // HackerNews 是英文社区：取扩展词中的英文变体检索（最多 2 个），无英文变体则直接跳过
        const hnTask = englishVariants.length === 0
          ? Promise.resolve([] as SearchResult[])
          : (async () => {
              const merged: SearchResult[] = [];
              for (const variant of englishVariants) {
                merged.push(...await searchHackerNews(variant));
              }
              return merged;
            })();

        const [bingResults, hackernewsResults, bilibiliResults] = await Promise.allSettled([
          searchBing(keyword.text),
          hnTask,
          searchBilibili(keyword.text)
        ]);

        const allResults: SearchResult[] = [];
        const sources: Array<{ name: string; result: PromiseSettledResult<SearchResult[]> }> = [
          { name: 'Bing', result: bingResults },
          { name: 'HackerNews', result: hackernewsResults },
          { name: 'Bilibili', result: bilibiliResults }
        ];
        for (const source of sources) {
          if (source.result.status === 'fulfilled') {
            const items = source.name === 'Bing'
              ? source.result.value.slice(0, config.bingSourceLimit)
              : source.result.value;
            allResults.push(...items);
            console.log(`  ${source.name}: ${items.length} results`);
          } else {
            console.log(`  ${source.name}: failed - ${source.result.reason}`);
          }
        }

        // 3. URL 去重 → 新鲜度过滤（15 天）
        const uniqueResults = deduplicateResults(allResults);
        const freshResults = filterByFreshness(uniqueResults);
        console.log(`  Total: ${allResults.length} raw → ${uniqueResults.length} unique → ${freshResults.length} fresh`);

        // 4. 标题相似度判重（对库内近 15 天标题 + 本轮批内两两比对）
        const recentTitles = getRecentTitles(15);
        const batchDeduped: SearchResult[] = [];
        for (const item of freshResults) {
          const dupDb = recentTitles.some(t => titleSimilarity(t.title, item.title) >= config.titleSimilarityThreshold);
          if (dupDb) { console.log(`  ⏭ Duplicate event (db): ${item.title.slice(0, 30)}...`); continue; }
          const dupBatch = batchDeduped.some(t => titleSimilarity(t.title, item.title) >= config.titleSimilarityThreshold);
          if (dupBatch) { console.log(`  ⏭ Duplicate event (batch): ${item.title.slice(0, 30)}...`); continue; }
          batchDeduped.push(item);
        }

        // 5. 热度预筛（互动信号规则，零成本）
        const engagementFiltered = prefilterByEngagement(batchDeduped);
        console.log(`  Engagement prefilter: ${batchDeduped.length} → ${engagementFiltered.length}`);
        if (engagementFiltered.length === 0) continue;

        // 6. AI 批量粗筛（一次调用），失败兜底取互动最高的前 quota 条
        const prioritized = prioritizeResults(engagementFiltered);
        const candidates: PrefilterCandidate[] = prioritized.map((item, index) => ({
          index,
          title: item.title,
          engagement: formatEngagement(item)
        }));
        let selected: SearchResult[];
        const picked = await batchPrefilter(candidates, keyword.text);
        if (picked) {
          selected = picked.map(i => prioritized[i]);
        } else {
          selected = prioritized.slice(0, config.perKeywordQuota);
        }
        selected = selected.slice(0, config.perKeywordQuota);
        console.log(`  AI prefilter: ${engagementFiltered.length} → ${selected.length} (quota ${config.perKeywordQuota})`);

        // 7. 逐条 AI 细评 → 阈值过滤 → 每日 Top N → 入库
        for (const item of selected) {
          try {
            if (getHotspotByUrl(item.url, item.source)) continue;

            const fullText = item.title + '\n' + item.content;
            const preMatch = preMatchKeyword(fullText, expandedKeywords);
            const engagementHint = item.source === 'bing'
              ? '来源 bing（不提供互动数据，忽略热度因素）'
              : `来源 ${item.source}，互动数据: ${formatEngagement(item)}`;
            const analysis = await analyzeContent(fullText, keyword.text, preMatch, engagementHint);

            if (!analysis.isReal) {
              console.log(`  ❌ Filtered fake/spam: ${item.title.slice(0, 30)}...`);
              continue;
            }
            if (analysis.relevance < config.relevanceMin) {
              console.log(`  ⏭ Relevance ${analysis.relevance} < ${config.relevanceMin}: ${item.title.slice(0, 30)}...`);
              continue;
            }
            const isImportant = analysis.importance === 'high' || analysis.importance === 'urgent';
            if (!analysis.keywordMentioned && !isImportant) {
              console.log(`  ⏭ Not mentioned & not important: ${item.title.slice(0, 30)}...`);
              continue;
            }

            // 每日 Top N 挤位：在精不在多
            const daily = getDailyKeywordStats(keyword.id);
            if (daily.count >= config.topNPerDay) {
              if (analysis.relevance <= (daily.minScore ?? 0)) {
                console.log(`  ⏭ Daily Top ${config.topNPerDay} full (score ${analysis.relevance} <= min ${daily.minScore}): ${item.title.slice(0, 30)}...`);
                continue;
              }
              if (daily.minScoreId) {
                deleteHotspot(daily.minScoreId);
                console.log(`  🔄 Displaced daily min (${daily.minScore}) with ${analysis.relevance}`);
              }
            }

            const hotspot = insertHotspot({
              title: item.title,
              content: item.content,
              url: item.url,
              source: item.source,
              analysis,
              viewCount: item.viewCount ?? null,
              likeCount: item.likeCount ?? null,
              commentCount: item.commentCount ?? null,
              danmakuCount: item.danmakuCount ?? null,
              authorName: item.author?.name ?? null,
              publishedAt: item.publishedAt ?? null,
              keywordId: keyword.id,
              keywordText: keyword.text
            });

            if (hotspot) {
              newHotspotsCount++;
              console.log(`  ✅ New hotspot [${item.source}] (${analysis.relevance}): ${hotspot.title.slice(0, 40)}...`);
              onNewHotspot(hotspot);
            }
          } catch (error) {
            console.error('  Error processing result:', error);
          }
        }

        // 避免过快请求下一个关键词
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`Error checking keyword "${keyword.text}":`, error);
      }
    }

    // 8. 清理超期数据
    const cleaned = cleanupOldHotspots(config.retentionDays);
    if (cleaned > 0) console.log(`🧹 Cleaned ${cleaned} hotspots older than ${config.retentionDays} days`);

    checkerStatus.lastRunAt = new Date().toISOString();
    checkerStatus.lastRunFound = newHotspotsCount;
    console.log(`\n✨ Hotspot check completed. Found ${newHotspotsCount} new hotspots.`);
    return { found: newHotspotsCount, skipped: false };
  } catch (error) {
    checkerStatus.lastError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    checkerStatus.running = false;
  }
}
