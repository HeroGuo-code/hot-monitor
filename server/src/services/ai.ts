import { config } from '../config.js';
import type { AIAnalysis } from '../types.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 调用 OpenRouter（OpenAI 兼容协议），带 30s 超时 + 失败重试 1 次。
 * 返回模型输出的原始文本，失败时抛出异常。
 */
async function chatCompletion(
  systemPrompt: string,
  userContent: string,
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  if (!config.openRouterKey) {
    throw new Error('OpenRouter API key not configured');
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.openRouterKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: config.aiModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent }
          ],
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.maxTokens ?? 500
        }),
        signal: AbortSignal.timeout(30_000)
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
      }

      const json = await res.json();
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim()) return content;
      if (Array.isArray(content)) {
        const joined = content.map((p: { text?: string }) => p.text || '').join('');
        if (joined.trim()) return joined;
      }
      throw new Error('Empty AI response');
    } catch (error) {
      lastError = error;
      if (attempt === 0) await sleep(1500); // 重试前稍等
    }
  }
  throw lastError;
}

/** 从模型输出中提取 JSON（容错处理代码块围栏、前后缀文本） */
function extractJson<T>(text: string, type: 'object' | 'array'): T | null {
  const pattern = type === 'array' ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
  const match = text.match(pattern);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

// ========== Query Expansion（查询扩展） ==========

/**
 * 将关键词扩展为多个变体用于文本预过滤，结果缓存避免重复调用 AI。
 * 无 Key 或调用失败时降级为纯文本核心词提取。
 */
const expansionCache = new Map<string, string[]>();

export async function expandKeyword(keyword: string): Promise<string[]> {
  const cached = expansionCache.get(keyword);
  if (cached) return cached;

  const coreTerms = extractCoreTerms(keyword);
  const fallback = [keyword, ...coreTerms];

  if (!config.openRouterKey) {
    expansionCache.set(keyword, fallback);
    return fallback;
  }

  const askExpansion = (extra: string) => chatCompletion(
    `你是一个搜索查询扩展专家。给定一个监控关键词，生成该关键词的变体和相关检索词，用于文本匹配。

规则：
1. 包含原始关键词的各种写法（大小写、空格、连字符变体）
2. 包含关键词的核心组成词（拆分后的各个有意义的词）
3. 包含常见别称、缩写、中英文对照
4. 必须包含 2-3 个英文检索词（HackerNews 等英文社区检索用，如"大模型"→"LLM"、"large language model"）
5. 不要加入泛化词（比如关键词是"Claude Sonnet 4.6"，不要加"AI模型"这种泛化词）
6. 总数控制在 5-15 个

输出 JSON 数组，只输出 JSON，不要有其他内容。
示例输入："Claude Sonnet 4.6"
示例输出：["Claude Sonnet 4.6", "Claude Sonnet", "Sonnet 4.6", "claude-sonnet-4.6", "Claude 4.6", "Anthropic Sonnet"]${extra}`,
    keyword,
    { temperature: 0.2, maxTokens: 300 }
  );

  try {
    const hasEnglish = (arr: string[]) => arr.some(v => /^[\x20-\x7E]+$/.test(v) && /[a-zA-Z]{3,}/.test(v));
    let parsed = extractJson<string[]>(await askExpansion(''), 'array');
    // HackerNews 为英文社区：扩展结果缺英文变体会使该源完全失效，此时强制重试一次
    if (!parsed || parsed.length === 0 || !hasEnglish(parsed)) {
      console.log(`  🔍 Query expansion retry for "${keyword}" (missing English variants)`);
      parsed = extractJson<string[]>(await askExpansion('\n重要：你的输出必须包含至少 2 个纯英文检索词（不含中文字符），例如 "LLM"、"AI Agent"。'), 'array');
    }
    if (parsed && parsed.length > 0) {
      const expanded = [...new Set([keyword, ...coreTerms, ...parsed.map(s => s.trim()).filter(Boolean)])];
      expansionCache.set(keyword, expanded);
      console.log(`  🔍 Query expansion for "${keyword}": ${expanded.length} variants`);
      return expanded;
    }
  } catch (error) {
    console.error('Query expansion failed:', error instanceof Error ? error.message : error);
  }

  expansionCache.set(keyword, fallback);
  return fallback;
}

/** 从关键词中提取核心词（纯文本方式，不依赖 AI） */
function extractCoreTerms(keyword: string): string[] {
  const terms: string[] = [];
  const parts = keyword.split(/[\s\-_\/\\·]+/).filter(p => p.length >= 2);
  if (parts.length > 1) {
    terms.push(...parts);
    for (let i = 0; i < parts.length - 1; i++) {
      terms.push(parts[i] + ' ' + parts[i + 1]);
    }
  }
  return [...new Set(terms)].filter(t => t.toLowerCase() !== keyword.toLowerCase());
}

// ========== 关键词预匹配 ==========

/** 检查文本是否包含任一扩展关键词（不区分大小写），作为 AI 不可用时的兜底 */
export function preMatchKeyword(text: string, expandedKeywords: string[]): { matched: boolean; matchedTerms: string[] } {
  const lowerText = text.toLowerCase();
  const matchedTerms: string[] = [];
  for (const kw of expandedKeywords) {
    if (lowerText.includes(kw.toLowerCase())) {
      matchedTerms.push(kw);
    }
  }
  return { matched: matchedTerms.length > 0, matchedTerms };
}

// ========== AI 批量粗筛（一次调用筛一批，控制成本） ==========

export interface PrefilterCandidate {
  index: number;
  title: string;
  engagement: string;
}

/**
 * 批量粗筛：一次调用打包全部候选（标题+互动数据），
 * 只让模型挑出"值得细看"的序号。失败时返回 null，由调用方按互动数兜底截断。
 */
export async function batchPrefilter(candidates: PrefilterCandidate[], keyword: string): Promise<number[] | null> {
  if (!config.openRouterKey || candidates.length === 0) return null;

  const list = candidates
    .map(c => `${c.index}. ${c.title.slice(0, 80)} [${c.engagement}]`)
    .join('\n');

  try {
    const raw = await chatCompletion(
      `你是热点监控粗筛助手。监控关键词是"【${keyword}】"，下面是从多个平台抓到的候选内容（附互动数据：点赞/评论/播放）。

任务：挑出所有"值得细看"的候选，标准：
1. 标题明显与关键词直接相关
2. 或互动数据很高（说明已经形成热度）

宁缺毋滥：明显不相关、明显是低质营销/标题党的直接排除。
只输出 JSON 数组（入选候选的序号），不要有其他内容。示例：[1,3,7]`,
      list,
      { temperature: 0.1, maxTokens: 150 }
    );

    const parsed = extractJson<number[]>(raw, 'array');
    if (parsed && Array.isArray(parsed)) {
      const valid = [...new Set(parsed.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < candidates.length))];
      console.log(`  🧹 AI 粗筛：${candidates.length} → ${valid.length}`);
      return valid;
    }
  } catch (error) {
    console.error('Batch prefilter failed:', error instanceof Error ? error.message : error);
  }
  return null;
}

// ========== AI 内容分析 ==========

function buildAnalysisPrompt(keyword: string, preMatchResult: { matched: boolean; matchedTerms: string[] }, engagementHint?: string): string {
  const matchHint = preMatchResult.matched
    ? `\n注意：文本预匹配发现内容中包含以下关键词变体：${preMatchResult.matchedTerms.join('、')}`
    : `\n注意：文本预匹配发现内容中未直接提及关键词"${keyword}"的任何变体，请特别严格审核相关性。`;

  const heatHint = engagementHint ? `\n互动数据参考：${engagementHint}` : '';

  return `你是一个热点内容精准匹配专家。你的任务是判断一段内容是否与指定的监控关键词【${keyword}】直接相关，并结合热度打分。

${matchHint}${heatHint}

分析要点：
1. 判断是否为真实有价值的信息（排除标题党、假新闻、营销软文）
2. 判断内容是否【直接】涉及关键词"${keyword}"。注意：
   - 仅仅属于同一领域但未提及关键词的内容，相关性应低于 40 分
   - 内容必须直接讨论、提及或与"${keyword}"有实质关联才能获得 60 分以上
   - 只是间接沾边（如同类产品、同领域但不同主题）应给 30-50 分
   - 关键词指代一个技术范畴时，评测/发布/实测该范畴下具体对象的内容视为直接相关（如关键词"大模型"，评测或实测某款具体大模型 → 60 分以上）
3. 判断内容中是否直接提及了"${keyword}"或其等价表述（keywordMentioned）
4. 评估热点的重要程度（对关注"${keyword}"的人来说有多重要）
5. 结合互动数据对热度加权打分（相关性达标的前提下）：
   - 互动火爆（播放10w+ / 点赞2000+ / 评论1000+ / HN 100分以上）→ 可上浮至 85-100
   - 互动中等（播放1w左右 / 点赞数百 / HN 30-100分）→ 75-90
   - 互动冷清（个位数播放或点赞）但相关性高 → 最高不超过 80
   - 来源不提供互动数据（如网页搜索）→ 忽略热度因素，按纯相关性打分
6. 用一句话说明此内容与"${keyword}"的关系（不是介绍内容本身，而是说"此内容与关键词的关联是什么"）
7. 用一句话解释你的相关性打分理由（若受热度影响请说明）
8. 用 50 字左右的中文简介概括这条内容"发生了什么"，客观陈述核心事实，不堆砌形容词

请以 JSON 格式输出：
{
  "isReal": true/false,
  "relevance": 0-100,
  "relevanceReason": "相关性打分理由...",
  "keywordMentioned": true/false,
  "importance": "low/medium/high/urgent",
  "summary": "此内容与【${keyword}】的关联：...",
  "brief": "50字左右的内容简介..."
}

只输出 JSON，不要有其他内容。`;
}

export async function analyzeContent(
  content: string,
  keyword: string,
  preMatchResult?: { matched: boolean; matchedTerms: string[] },
  engagementHint?: string
): Promise<AIAnalysis> {
  const matchResult = preMatchResult ?? { matched: false, matchedTerms: [] };

  // 无 Key 时降级：直接用预匹配结果打分，服务仍可用
  if (!config.openRouterKey) {
    return fallbackAnalysis(content, matchResult, '未配置 AI 服务，使用预匹配分数');
  }

  try {
    const raw = await chatCompletion(
      buildAnalysisPrompt(keyword, matchResult, engagementHint),
      content.slice(0, 2000),
      { temperature: 0.2, maxTokens: 500 }
    );

    const parsed = extractJson<Record<string, unknown>>(raw, 'object');
    if (!parsed) throw new Error('Failed to parse AI response');

    return {
      isReal: Boolean(parsed.isReal),
      relevance: Math.min(100, Math.max(0, Number(parsed.relevance) || 0)),
      relevanceReason: String(parsed.relevanceReason || '').slice(0, 200),
      keywordMentioned: Boolean(parsed.keywordMentioned),
      importance: ['low', 'medium', 'high', 'urgent'].includes(parsed.importance as string)
        ? (parsed.importance as AIAnalysis['importance'])
        : 'low',
      summary: String(parsed.summary || '').slice(0, 150),
      brief: String(parsed.brief || '').slice(0, 100)
    };
  } catch (error) {
    console.error('AI analysis failed:', error instanceof Error ? error.message : error);
    return fallbackAnalysis(content, matchResult, 'AI 分析失败，使用预匹配分数');
  }
}

function fallbackAnalysis(
  content: string,
  matchResult: { matched: boolean; matchedTerms: string[] },
  reason: string
): AIAnalysis {
  return {
    isReal: true,
    relevance: matchResult.matched ? 50 : 20,
    relevanceReason: reason,
    keywordMentioned: matchResult.matched,
    importance: 'low',
    summary: content.slice(0, 50) + '...',
    brief: content.replace(/\s+/g, ' ').slice(0, 50)
  };
}

/** 批量分析，限制并发数为 3，防止打爆 API 限流 */
export async function batchAnalyze(
  contents: string[],
  keyword: string,
  expandedKeywords?: string[]
): Promise<AIAnalysis[]> {
  const batchSize = 3;
  const results: AIAnalysis[] = [];

  for (let i = 0; i < contents.length; i += batchSize) {
    const batch = contents.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(content => {
        const preMatch = expandedKeywords
          ? preMatchKeyword(content, expandedKeywords)
          : undefined;
        return analyzeContent(content, keyword, preMatch);
      })
    );
    results.push(...batchResults);
  }

  return results;
}
