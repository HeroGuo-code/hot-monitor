import express from 'express';
import cron from 'node-cron';
import type { Response } from 'express';

import { config } from './config.js';
import { closeDb, listKeywords, type HotspotDTO } from './db.js';
import keywordsRouter from './routes/keywords.js';
import hotspotsRouter from './routes/hotspots.js';
import { runHotspotCheck, checkerStatus } from './jobs/hotspotChecker.js';

const app = express();
app.use(express.json());

// ========== SSE（替代 Socket.io，单向下发场景更轻更稳） ==========

const sseClients = new Set<Response>();

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Nginx 反代不缓冲
  });
  res.write('retry: 5000\n\n');
  res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

  sseClients.add(res);

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { /* 断开的连接由 close 事件清理 */ }
  }
}

// ========== 路由 ==========

app.use('/api/keywords', keywordsRouter);
app.use('/api/hotspots', hotspotsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 服务状态（抓取进度、上次运行结果）
app.get('/api/status', (_req, res) => {
  res.json({
    ...checkerStatus,
    activeKeywords: listKeywords().filter(k => k.isActive).length,
    aiEnabled: Boolean(config.openRouterKey)
  });
});

// 手动触发抓取：立即返回，进度通过 /api/status 与 SSE 观察
app.post('/api/check-hotspots', (_req, res) => {
  if (checkerStatus.running) {
    return res.status(409).json({ message: 'Hotspot check already running' });
  }
  res.json({ message: 'Hotspot check started' });
  runHotspotCheck(hotspot => broadcast('hotspot:new', hotspot))
    .then(({ found }) => {
      broadcast('check:done', { found, at: new Date().toISOString() });
    })
    .catch(error => {
      console.error('Manual hotspot check failed:', error);
      broadcast('check:error', { message: error instanceof Error ? error.message : String(error) });
    });
});

// ========== 定时任务 ==========

cron.schedule(config.cronExpression, async () => {
  console.log('🔄 Running scheduled hotspot check...');
  try {
    const { found } = await runHotspotCheck(hotspot => broadcast('hotspot:new', hotspot));
    broadcast('check:done', { found, at: new Date().toISOString() });
    console.log(`✅ Scheduled hotspot check completed, ${found} new hotspots`);
  } catch (error) {
    console.error('❌ Scheduled hotspot check failed:', error);
  }
});

// ========== 启动 ==========

const server = app.listen(config.port, () => {
  console.log(`
  🔥 热点监控服务启动成功 (Lite)
  📡 API: http://localhost:${config.port}
  📡 SSE: http://localhost:${config.port}/api/events
  ⏰ 定时抓取: ${config.cronExpression}
  🤖 AI 模型: ${config.openRouterKey ? config.aiModel : '未配置（降级模式）'}
  `);
});

// Graceful shutdown
function shutdown(): void {
  console.log('Shutting down...');
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // 兜底强制退出
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { broadcast };
