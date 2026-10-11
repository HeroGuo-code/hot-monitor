# Hot Monitor — AI 热点监控看板

多源召回 + 漏斗式 AI 筛选的实时热点监控系统，自动追踪 AI 领域"少而精"的热点，并通过 SSE 实时推送到看板。

**在线演示**：[hot.guohaoai.com](https://hot.guohaoai.com)

## 核心设计：漏斗式筛选

不做"延时搜索引擎"，而是让每一条入库的热点都经过层层收敛，保证**少而精**：

```
多源召回（Bing / HackerNews / Bilibili）
  → URL 去重 + 15 天时效过滤
  → 标题相似度判重（跨源/跨轮同事件只收一条，bigram Jaccard ≥ 0.6）
  → 互动数据预筛（零 AI 成本：HN ≥ 30 分 / B站播放 ≥ 1w 或爆发率 ≥ 500/h）
  → AI 批量粗筛（一次调用打包筛一批，控制 token 成本）
  → AI 细评 + 热度加权打分（互动火爆可上浮至 85-100，冷门内容上限 80）
  → 阈值过滤（相关度 ≥ 70）
  → 每日 Top N 挤位（每关键词每天最多 5 条，新热点挤掉当日最低分）
```

## 功能特性

- **多源抓取**：Bing 网页搜索、HackerNews（英文社区，自动生成英文检索词）、Bilibili（综合排序 + 爆发率指标）
- **查询扩展**：AI 自动生成关键词变体与中英文对照（带缓存，缺英文变体自动重试）
- **热度加权打分**：互动数据参与 AI 评分，相关度是准入线、互动量决定名次
- **实时推送**：SSE 秒级触达，新热点入库所有打开的看板同步弹出
- **定时调度**：node-cron 每小时整点自动抓取（可配置）
- **成本护栏**：活跃关键词数量上限、批量粗筛控制调用次数、无 API Key 自动降级为预匹配打分、超龄数据自动清理
- **手动搜索**：输入任意关键词即时多源搜索 + AI 分析（结果不入库）

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js 20 · Express 5 · better-sqlite3 (WAL) · node-cron · cheerio |
| AI | OpenRouter（OpenAI 兼容协议，默认 deepseek/deepseek-v3.2），原生 fetch 调用 |
| 前端 | React 19 · Vite 7 · Tailwind CSS 4 · lucide-react |
| 实时通信 | SSE（25s 心跳，Nginx 不缓冲透传） |

## 快速开始

```bash
# 1. 后端
cd server
npm install
cp .env.example .env        # 填入 OPENROUTER_API_KEY
npm run dev                 # http://localhost:3001

# 2. 前端（另开终端）
cd client
npm install
npm run dev                 # http://localhost:5173
```

不配置 API Key 服务也可运行，AI 分析将降级为文本预匹配打分（功能受限，推荐配置）。

## 服务器部署

`deploy/` 目录提供一键部署脚本（适用于境外 Linux 服务器，前端本地构建后上传，避免在低内存服务器上执行构建）：

```bash
# 本地打包
pwsh deploy/package.ps1     # 产出 deploy/hot-monitor-deploy.tar.gz

# 上传后在服务器执行（自动安装依赖、编译、注册 systemd、写 Nginx 站点配置）
sudo bash deploy.sh <你的域名>

# 填入 API Key 后重启
vi /opt/hot-monitor/server/.env
systemctl restart hot-monitor
```

> Cloudflare 接入提示：SSL 模式 Flexible，`/api/*` 路径需配置缓存绕过（SSE 不能被边缘缓存），其余静态资源可开边缘缓存。

## 关键配置（server/src/config.ts）

| 配置 | 默认值 | 说明 |
|---|---|---|
| `maxAgeHours` | 360（15 天） | 热点时效性上限 |
| `cronExpression` | `0 * * * *` | 定时抓取周期 |
| `relevanceMin` | 70 | 入库最低相关度 |
| `topNPerDay` | 5 | 每关键词每日入库上限 |
| `maxActiveKeywords` | 10 | 活跃关键词数量上限 |
| `titleSimilarityThreshold` | 0.6 | 标题判重阈值 |
| `retentionDays` | 30 | 数据保留天数 |

## 项目结构

```
hot-monitor/
├── server/               # Express 后端
│   ├── src/jobs/         # 定时抓取 + 漏斗筛选主流程
│   ├── src/services/     # 多源搜索、B站API、AI分析
│   ├── src/routes/       # 关键词 / 热点 / 手动搜索 API
│   └── src/db.ts         # SQLite（better-sqlite3, WAL）
├── client/               # React 看板前端
└── deploy/               # 部署脚本 / systemd / Nginx 配置
```

## License

MIT
