#!/usr/bin/env bash
# AI 热点监控（Lite）服务器端一键部署脚本
# 前置条件：已在本地执行 deploy/package.ps1 并将 hot-monitor-deploy.tar.gz 上传至服务器
# 用法：sudo bash deploy.sh <你的域名，例如 hot.guohaoai.com>
set -e

DOMAIN=${1:-}
if [ -z "$DOMAIN" ]; then
  echo "用法: sudo bash deploy.sh <域名>"
  exit 1
fi

INSTALL_DIR=/opt/hot-monitor
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

# 1. 检查 Node >= 20
if ! command -v node >/dev/null 2>&1; then
  echo "错误: 未安装 Node.js，请先安装 Node.js 20+"
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "错误: Node.js 版本需 >= 20，当前 $(node -v)"
  exit 1
fi
echo "✅ Node $(node -v)"

# 2. 解压部署包
mkdir -p "$INSTALL_DIR"
tar -xzf "$SCRIPT_DIR/hot-monitor-deploy.tar.gz" -C "$INSTALL_DIR"
echo "✅ 文件已解压到 $INSTALL_DIR"

# 3. 安装后端依赖并编译（tsc 纯类型编译，内存占用极低）
cd "$INSTALL_DIR/server"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "⚠️  已生成 $INSTALL_DIR/server/.env，请编辑填入 OPENROUTER_API_KEY 后重启服务"
fi
npm install --no-audit --no-fund
npm run build
npm prune --omit=dev   # 编译完成后移除 devDependencies（typescript 等），只留运行时依赖
echo "✅ 后端依赖与编译完成"

# 4. systemd 服务
cp "$INSTALL_DIR/deploy/hot-monitor.service" /etc/systemd/system/hot-monitor.service
sed -i "s|ExecStart=/usr/bin/node|ExecStart=$(command -v node)|" /etc/systemd/system/hot-monitor.service
systemctl daemon-reload
systemctl enable hot-monitor
systemctl restart hot-monitor   # 必须显式 restart：enable --now 不会重启已运行的服务，会导致更新代码不生效
echo "✅ systemd 服务已启动: systemctl status hot-monitor"

# 5. Nginx 站点配置
if [ -d /etc/nginx/conf.d ]; then
  sed "s/hot.guohaoai.com/$DOMAIN/g" "$INSTALL_DIR/deploy/nginx-hot-monitor.conf" > /etc/nginx/conf.d/hot-monitor.conf
  nginx -t && systemctl reload nginx
  echo "✅ Nginx 站点配置已生效: http://$DOMAIN"
else
  echo "⚠️  未检测到 /etc/nginx/conf.d，请手动配置 Nginx（模板: $INSTALL_DIR/deploy/nginx-hot-monitor.conf）"
fi

echo ""
echo "🎉 部署完成！后续步骤："
echo "   1. 编辑 $INSTALL_DIR/server/.env 填入 OPENROUTER_API_KEY（或保留 APIKEY_FILE 指向本地 Key 文件）"
echo "   2. systemctl restart hot-monitor"
echo "   3. 在 Cloudflare 为 $DOMAIN 添加 A 记录指向服务器 IP（SSL 模式 Flexible，/api/* 绕缓存）"
