import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

/**
 * OpenRouter API Key 加载优先级：
 * 1. 环境变量 OPENROUTER_API_KEY
 * 2. 环境变量 APIKEY_FILE 指定的文件
 * 3. 项目上级目录的 apikey.txt（本地开发约定，自动提取 sk-or-v1- 开头的 Key）
 */
function loadOpenRouterApiKey(): { key: string; source: string } {
  if (process.env.OPENROUTER_API_KEY) {
    return { key: process.env.OPENROUTER_API_KEY.trim(), source: 'env:OPENROUTER_API_KEY' };
  }

  const candidates = [
    ...(process.env.APIKEY_FILE ? [process.env.APIKEY_FILE] : []),
    path.resolve(process.cwd(), '../../apikey.txt'),
    path.resolve(process.cwd(), '../apikey.txt')
  ];

  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf-8');
        const match = content.match(/sk-or-v1-[A-Za-z0-9]+/);
        if (match) return { key: match[0], source: file };
      }
    } catch {
      // 忽略读取失败，继续尝试下一个候选路径
    }
  }
  return { key: '', source: 'none' };
}

const loaded = loadOpenRouterApiKey();

export const config = {
  port: Number(process.env.PORT || 3001),
  aiModel: process.env.AI_MODEL || 'deepseek/deepseek-v3.2',
  openRouterKey: loaded.key,
  openRouterKeySource: loaded.source,
  /** 抓取结果新鲜度上限（小时）：热点时效性 15 天 */
  maxAgeHours: 15 * 24,
  /** 热点数据保留天数，超期自动清理 */
  retentionDays: 30,
  /** 定时抓取间隔（cron 表达式），默认每 1 小时 */
  cronExpression: process.env.CRON_EXPRESSION || '0 * * * *',

  // ===== 热度预筛（互动信号规则，零 AI 成本） =====
  /** HackerNews 最低点赞数 */
  hnPointsMin: 30,
  /** HackerNews 最低评论数 */
  hnCommentsMin: 15,
  /** B站 最低播放量 */
  biliViewMin: 10000,
  /** B站 爆发率阈值：播放量 / 发布小时数（2小时5000播放=2500，能过） */
  biliVelocityMin: 500,
  /** Bing 无互动信号，每关键词每轮最多取几条作为补充 */
  bingSourceLimit: 3,

  // ===== AI 粗筛与入库 =====
  /** 每关键词每轮进入 AI 细评的最大条数 */
  perKeywordQuota: 8,
  /** 入库最低相关度 */
  relevanceMin: 70,
  /** 入库标题相似度阈值（Jaccard bigram），超过视为同一事件不重复入库 */
  titleSimilarityThreshold: 0.6,
  /** 同一关键词每日最多入库条数（在精不在多，新热点挤掉当日最低分） */
  topNPerDay: 5,
  /** 活跃关键词数量上限（公开访问时防止被灌入大量关键词放大 AI 成本） */
  maxActiveKeywords: 10
};

if (!config.openRouterKey) {
  console.warn('⚠️ 未找到 OpenRouter API Key（尝试过 env 与 apikey.txt），AI 分析将降级为文本预匹配打分');
} else {
  console.log(`✅ OpenRouter API Key 已加载（来源: ${config.openRouterKeySource}）`);
}
