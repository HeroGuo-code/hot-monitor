import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { sortHotspots } from './utils/sortHotspots.js';
import type { HotspotRow, HotspotDTO, AIAnalysis } from './types.js';

export type { HotspotDTO };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.resolve(__dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });

export const db: BetterSqlite3.Database = new Database(path.join(dataDir, 'hot-monitor.db'));

// WAL 模式：读写不互斥，避免抓取写入时 API 查询被锁
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS keywords (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL UNIQUE,
    category TEXT,
    isActive INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS hotspots (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL,
    source TEXT NOT NULL,
    isReal INTEGER NOT NULL DEFAULT 1,
    relevance INTEGER NOT NULL DEFAULT 0,
    relevanceReason TEXT,
    keywordMentioned INTEGER,
    importance TEXT NOT NULL DEFAULT 'low',
    summary TEXT,
    viewCount INTEGER,
    likeCount INTEGER,
    commentCount INTEGER,
    danmakuCount INTEGER,
    authorName TEXT,
    publishedAt TEXT,
    keywordId TEXT,
    keywordText TEXT,
    createdAt TEXT NOT NULL,
    UNIQUE(url, source)
  );

  CREATE INDEX IF NOT EXISTS idx_hotspots_keyword ON hotspots(keywordId, createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_hotspots_created ON hotspots(createdAt DESC);
  CREATE INDEX IF NOT EXISTS idx_hotspots_source ON hotspots(source);
`);

// 轻量迁移：老库补 brief 列（50 字简介）
{
  const cols = db.prepare('PRAGMA table_info(hotspots)').all() as { name: string }[];
  if (!cols.some(c => c.name === 'brief')) {
    db.exec('ALTER TABLE hotspots ADD COLUMN brief TEXT');
    console.log('✅ 已为 hotspots 表补充 brief 列');
  }
}

const nowIso = () => new Date().toISOString();

// ========== 关键词 ==========

export interface KeywordRow {
  id: string;
  text: string;
  category: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  hotspotCount: number;
}

export function listKeywords(): KeywordRow[] {
  const rows = db.prepare(`
    SELECT k.id, k.text, k.category, k.isActive, k.createdAt, k.updatedAt,
           COUNT(h.id) AS hotspotCount
    FROM keywords k
    LEFT JOIN hotspots h ON h.keywordId = k.id
    GROUP BY k.id
    ORDER BY k.createdAt DESC
  `).all() as (Omit<KeywordRow, 'isActive'> & { isActive: number })[];
  return rows.map(r => ({ ...r, isActive: r.isActive === 1 }));
}

export function createKeyword(text: string, category: string | null): KeywordRow {
  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(
    'INSERT INTO keywords (id, text, category, isActive, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)'
  ).run(id, text, category, now, now);
  return {
    id, text, category, isActive: true, createdAt: now, updatedAt: now, hotspotCount: 0
  };
}

export function getKeyword(id: string): KeywordRow | undefined {
  const row = db.prepare(`
    SELECT k.id, k.text, k.category, k.isActive, k.createdAt, k.updatedAt,
           COUNT(h.id) AS hotspotCount
    FROM keywords k
    LEFT JOIN hotspots h ON h.keywordId = k.id
    WHERE k.id = ?
    GROUP BY k.id
  `).get(id) as (Omit<KeywordRow, 'isActive'> & { isActive: number }) | undefined;
  return row ? { ...row, isActive: row.isActive === 1 } : undefined;
}

export function updateKeyword(
  id: string,
  fields: { text?: string; category?: string | null; isActive?: boolean }
): KeywordRow | undefined {
  const sets: string[] = ['updatedAt = ?'];
  const values: (string | number | null)[] = [nowIso()];
  if (fields.text !== undefined) { sets.push('text = ?'); values.push(fields.text); }
  if (fields.category !== undefined) { sets.push('category = ?'); values.push(fields.category); }
  if (fields.isActive !== undefined) { sets.push('isActive = ?'); values.push(fields.isActive ? 1 : 0); }
  values.push(id);
  db.prepare(`UPDATE keywords SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getKeyword(id);
}

export function deleteKeyword(id: string): boolean {
  const info = db.prepare('DELETE FROM keywords WHERE id = ?').run(id);
  return info.changes > 0;
}

// ========== 热点 ==========

export interface HotspotInput {
  title: string;
  content: string;
  url: string;
  source: string;
  analysis: AIAnalysis;
  viewCount?: number | null;
  likeCount?: number | null;
  commentCount?: number | null;
  danmakuCount?: number | null;
  authorName?: string | null;
  publishedAt?: Date | null;
  keywordId: string;
  keywordText: string;
}

/** 序列化为前端对象（布尔值转换 + keyword 冗余字段组装） */
export function toHotspotDTO(row: HotspotRow): HotspotDTO {
  return {
    ...row,
    isReal: row.isReal === 1,
    keywordMentioned: row.keywordMentioned === null ? null : row.keywordMentioned === 1,
    keyword: row.keywordId && row.keywordText
      ? { id: row.keywordId, text: row.keywordText }
      : null
  };
}

function getHotspotRow(id: string): HotspotRow | undefined {
  return db.prepare('SELECT * FROM hotspots WHERE id = ?').get(id) as HotspotRow | undefined;
}

export function getHotspotByUrl(url: string, source: string): HotspotRow | undefined {
  return db.prepare('SELECT * FROM hotspots WHERE url = ? AND source = ?').get(url, source) as HotspotRow | undefined;
}

export function insertHotspot(input: HotspotInput): HotspotDTO | null {
  const info = db.prepare(`
    INSERT OR IGNORE INTO hotspots (
      id, title, content, url, source, isReal, relevance, relevanceReason,
      keywordMentioned, importance, summary, brief, viewCount, likeCount, commentCount,
      danmakuCount, authorName, publishedAt, keywordId, keywordText, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    input.title,
    input.content,
    input.url,
    input.source,
    input.analysis.isReal ? 1 : 0,
    input.analysis.relevance,
    input.analysis.relevanceReason,
    input.analysis.keywordMentioned === null ? null : input.analysis.keywordMentioned ? 1 : 0,
    input.analysis.importance,
    input.analysis.summary,
    input.analysis.brief,
    input.viewCount ?? null,
    input.likeCount ?? null,
    input.commentCount ?? null,
    input.danmakuCount ?? null,
    input.authorName ?? null,
    input.publishedAt ? input.publishedAt.toISOString() : null,
    input.keywordId,
    input.keywordText,
    nowIso()
  );
  if (info.changes === 0) return null; // 已存在（url+source 唯一约束）
  const row = db.prepare('SELECT * FROM hotspots WHERE url = ? AND source = ?').get(input.url, input.source) as HotspotRow;
  return toHotspotDTO(row);
}

export interface HotspotFilters {
  page: number;
  limit: number;
  source?: string;
  importance?: string;
  keywordId?: string;
  timeRange?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export function listHotspots(filters: HotspotFilters): { data: HotspotDTO[]; total: number } {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (filters.source) { where.push('source = ?'); params.push(filters.source); }
  if (filters.importance) { where.push('importance = ?'); params.push(filters.importance); }
  if (filters.keywordId) { where.push('keywordId = ?'); params.push(filters.keywordId); }

  if (filters.timeRange) {
    const now = new Date();
    let from: Date | null = null;
    switch (filters.timeRange) {
      case '1h': from = new Date(now.getTime() - 3600 * 1000); break;
      case 'today': from = new Date(now); from.setHours(0, 0, 0, 0); break;
      case '7d': from = new Date(now.getTime() - 7 * 24 * 3600 * 1000); break;
      case '30d': from = new Date(now.getTime() - 30 * 24 * 3600 * 1000); break;
    }
    if (from) { where.push('createdAt >= ?'); params.push(from.toISOString()); }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const desc = (filters.sortOrder ?? 'desc') === 'desc';

  // importance / hot 需要内存排序；其余直接走 SQL 索引
  if (filters.sortBy === 'importance' || filters.sortBy === 'hot') {
    const rows = db.prepare(`SELECT * FROM hotspots ${whereSql}`).all(...params) as HotspotRow[];
    const sorted = sortHotspots(rows, filters.sortBy, filters.sortOrder ?? 'desc');
    const start = (filters.page - 1) * filters.limit;
    return {
      data: sorted.slice(start, start + filters.limit).map(toHotspotDTO),
      total: rows.length
    };
  }

  let orderSql: string;
  switch (filters.sortBy) {
    case 'publishedAt':
      // 无发布时间的排到最后
      orderSql = desc
        ? 'ORDER BY (publishedAt IS NULL) ASC, publishedAt DESC, createdAt DESC'
        : 'ORDER BY (publishedAt IS NULL) DESC, publishedAt ASC, createdAt DESC';
      break;
    case 'relevance':
      orderSql = `ORDER BY relevance ${desc ? 'DESC' : 'ASC'}, createdAt DESC`;
      break;
    default:
      orderSql = `ORDER BY createdAt ${desc ? 'DESC' : 'ASC'}`;
  }

  const total = (db.prepare(`SELECT COUNT(*) AS c FROM hotspots ${whereSql}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT * FROM hotspots ${whereSql} ${orderSql} LIMIT ? OFFSET ?`
  ).all(...params, filters.limit, (filters.page - 1) * filters.limit) as HotspotRow[];

  return { data: rows.map(toHotspotDTO), total };
}

export function hotspotStats(): { total: number; today: number; urgent: number; bySource: Record<string, number> } {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const total = (db.prepare('SELECT COUNT(*) AS c FROM hotspots').get() as { c: number }).c;
  const today = (db.prepare('SELECT COUNT(*) AS c FROM hotspots WHERE createdAt >= ?').get(todayStart.toISOString()) as { c: number }).c;
  const urgent = (db.prepare("SELECT COUNT(*) AS c FROM hotspots WHERE importance IN ('high','urgent')").get() as { c: number }).c;
  const bySourceRows = db.prepare('SELECT source, COUNT(*) AS c FROM hotspots GROUP BY source').all() as { source: string; c: number }[];
  return {
    total,
    today,
    urgent,
    bySource: bySourceRows.reduce((acc, r) => { acc[r.source] = r.c; return acc; }, {} as Record<string, number>)
  };
}

export function deleteHotspot(id: string): boolean {
  const info = db.prepare('DELETE FROM hotspots WHERE id = ?').run(id);
  return info.changes > 0;
}

/** 清理超过保留期的热点，防止数据库无限膨胀 */
export function cleanupOldHotspots(days: number): number {
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const info = db.prepare('DELETE FROM hotspots WHERE createdAt < ?').run(cutoff);
  return info.changes;
}

/** 取近期热点标题用于跨轮/跨源相似度判重 */
export function getRecentTitles(days: number): { id: string; title: string; source: string }[] {
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  return db.prepare('SELECT id, title, source FROM hotspots WHERE createdAt >= ?').all(cutoff) as
    { id: string; title: string; source: string }[];
}

export interface DailyKeywordStats {
  count: number;
  minScoreId: string | null;
  minScore: number | null;
}

/** 某关键词当日（按 createdAt）入库统计，用于每日 Top N 挤位 */
export function getDailyKeywordStats(keywordId: string): DailyKeywordStats {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const row = db.prepare(`
    SELECT COUNT(*) AS count, MIN(relevance) AS minScore
    FROM hotspots WHERE keywordId = ? AND createdAt >= ?
  `).get(keywordId, todayStart.toISOString()) as { count: number; minScore: number | null };

  let minScoreId: string | null = null;
  if (row.minScore !== null && row.count >= 1) {
    const minRow = db.prepare(`
      SELECT id FROM hotspots
      WHERE keywordId = ? AND createdAt >= ? AND relevance = ?
      ORDER BY createdAt ASC LIMIT 1
    `).get(keywordId, todayStart.toISOString(), row.minScore) as { id: string } | undefined;
    minScoreId = minRow?.id ?? null;
  }
  return { count: row.count, minScoreId, minScore: row.minScore };
}

/** 优雅关闭 */
export function closeDb(): void {
  db.close();
}
