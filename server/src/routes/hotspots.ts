import { Router } from 'express';
import { listHotspots, hotspotStats, deleteHotspot } from '../db.js';
import { searchAll } from '../services/search.js';
import { analyzeContent } from '../services/ai.js';

const router = Router();

// 获取热点列表（筛选/排序/分页）
router.get('/', (req, res) => {
  try {
    const {
      page = '1',
      limit = '20',
      source,
      importance,
      keywordId,
      timeRange,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));

    const { data, total } = listHotspots({
      page: pageNum,
      limit: limitNum,
      source: source as string | undefined,
      importance: importance as string | undefined,
      keywordId: keywordId as string | undefined,
      timeRange: timeRange as string | undefined,
      sortBy: sortBy as string | undefined,
      sortOrder: (sortOrder === 'asc' ? 'asc' : 'desc')
    });

    res.json({
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching hotspots:', error);
    res.status(500).json({ error: 'Failed to fetch hotspots' });
  }
});

// 热点统计
router.get('/stats', (_req, res) => {
  try {
    res.json(hotspotStats());
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// 全网搜索：聚合多源 + AI 分析前几条（不入库）
router.post('/search', async (req, res) => {
  try {
    const { query, sources = ['bing', 'hackernews', 'bilibili'] } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query is required' });
    }

    const results = await searchAll(query, sources);

    // AI 分析前 8 条（并发 2，控制耗时）
    const toAnalyze = results.slice(0, 8);
    const analyzed = await Promise.all(
      toAnalyze.map(async item => {
        try {
          const metrics = [
            item.viewCount ? `播放${item.viewCount}` : null,
            item.likeCount ? `赞${item.likeCount}` : null,
            item.commentCount ? `评论${item.commentCount}` : null
          ].filter(Boolean).join('/');
          const engagementHint = metrics
            ? `来源 ${item.source}，互动数据: ${metrics}`
            : `来源 ${item.source}（不提供互动数据，忽略热度因素）`;
          const analysis = await analyzeContent(item.title + '\n' + item.content, query, undefined, engagementHint);
          return { ...item, publishedAt: item.publishedAt?.toISOString() ?? null, analysis };
        } catch {
          return { ...item, publishedAt: item.publishedAt?.toISOString() ?? null, analysis: null };
        }
      })
    );
    const rest = results.slice(8).map(item => ({
      ...item,
      publishedAt: item.publishedAt?.toISOString() ?? null,
      analysis: null
    }));

    res.json({ results: [...analyzed, ...rest] });
  } catch (error) {
    console.error('Error searching hotspots:', error);
    res.status(500).json({ error: 'Failed to search hotspots' });
  }
});

// 删除热点
router.delete('/:id', (req, res) => {
  try {
    const deleted = deleteHotspot(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Hotspot not found' });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting hotspot:', error);
    res.status(500).json({ error: 'Failed to delete hotspot' });
  }
});

export default router;
