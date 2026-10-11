import { Router } from 'express';
import { listKeywords, createKeyword, updateKeyword, deleteKeyword, getKeyword } from '../db.js';
import { config } from '../config.js';

const router = Router();

/** 当前活跃关键词数量（公开部署时限制总量，防止 AI 成本被放大） */
function activeKeywordCount(): number {
  return listKeywords().filter(k => k.isActive).length;
}

function activeLimitReached(res: { status: (n: number) => { json: (b: unknown) => void } }): boolean {
  if (activeKeywordCount() >= config.maxActiveKeywords) {
    res.status(400).json({ error: `活跃关键词已达上限（${config.maxActiveKeywords} 个），请先停用或删除部分关键词` });
    return true;
  }
  return false;
}

// 获取所有关键词（含热点计数）
router.get('/', (_req, res) => {
  try {
    res.json(listKeywords());
  } catch (error) {
    console.error('Error fetching keywords:', error);
    res.status(500).json({ error: 'Failed to fetch keywords' });
  }
});

// 创建关键词
router.post('/', (req, res) => {
  try {
    const { text, category } = req.body;
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Keyword text is required' });
    }
    if (activeLimitReached(res)) return; // 新关键词默认激活，受总量上限约束
    const keyword = createKeyword(text.trim(), category?.trim() || null);
    res.status(201).json(keyword);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Keyword already exists' });
    }
    console.error('Error creating keyword:', error);
    res.status(500).json({ error: 'Failed to create keyword' });
  }
});

// 更新关键词（文本/分类/激活状态）
router.put('/:id', (req, res) => {
  try {
    const { text, category, isActive } = req.body;
    const existing = getKeyword(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Keyword not found' });
    // 激活操作受总量上限约束（停用不受限）
    if (isActive === true && !existing.isActive && activeLimitReached(res)) return;
    const keyword = updateKeyword(req.params.id, {
      ...(text !== undefined && { text: typeof text === 'string' ? text.trim() : undefined }),
      ...(category !== undefined && { category: category?.trim() || null }),
      ...(isActive !== undefined && { isActive: Boolean(isActive) })
    });
    if (!keyword) return res.status(404).json({ error: 'Keyword not found' });
    res.json(keyword);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Keyword already exists' });
    }
    console.error('Error updating keyword:', error);
    res.status(500).json({ error: 'Failed to update keyword' });
  }
});

// 切换激活状态
router.patch('/:id/toggle', (req, res) => {
  try {
    const existing = getKeyword(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Keyword not found' });
    // 激活方向受总量上限约束（停用不受限）
    if (!existing.isActive && activeLimitReached(res)) return;
    const keyword = updateKeyword(req.params.id, { isActive: !existing.isActive });
    res.json(keyword);
  } catch (error) {
    console.error('Error toggling keyword:', error);
    res.status(500).json({ error: 'Failed to toggle keyword' });
  }
});

// 删除关键词
router.delete('/:id', (req, res) => {
  try {
    const deleted = deleteKeyword(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Keyword not found' });
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting keyword:', error);
    res.status(500).json({ error: 'Failed to delete keyword' });
  }
});

export default router;
