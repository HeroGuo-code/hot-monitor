# 本地打包脚本：构建前端 + 直接打包部署产物（免 staging，服务器解压即用）
# 用法：powershell -ExecutionPolicy Bypass -File deploy/package.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$nodePortable = "C:\Users\gh200\.local\lib\nodejs\node-v20.18.1-win-x64"
$env:Path = "$nodePortable;" + $env:Path

# 1. 前端本地构建（服务器绝不构建，防 OOM）
Write-Host "==> 构建前端..." -ForegroundColor Cyan
Push-Location "$root\client"
npm run build
Pop-Location

# 2. 打 tar 包：后端源码（服务器端 npm install + tsc）+ 前端预构建产物 + 部署文件
Write-Host "==> 打包 hot-monitor-deploy.tar.gz ..." -ForegroundColor Cyan
$tarPath = "$root\deploy\hot-monitor-deploy.tar.gz"
if (Test-Path $tarPath) { Remove-Item $tarPath }
tar -czf $tarPath -C $root `
  server/src `
  server/tsconfig.json server/package.json server/.env.example `
  client/dist `
  deploy/deploy.sh deploy/hot-monitor.service deploy/nginx-hot-monitor.conf
if ($LASTEXITCODE -ne 0) { throw "tar 打包失败 (exit $LASTEXITCODE)" }

# 3. 校验：条目数必须覆盖关键文件
$tarList = tar -tzf $tarPath
$mustHave = @('server/src/index.ts', 'server/src/db.ts', 'server/package.json', 'client/dist/index.html', 'deploy/deploy.sh')
foreach ($f in $mustHave) {
  if (-not ($tarList | Where-Object { $_ -like "*$f*" })) { throw "打包校验失败: 缺少 $f" }
}

$size = [math]::Round((Get-Item $tarPath).Length / 1KB, 1)
Write-Host "✅ 打包完成: $tarPath ($size KB, $($tarList.Count) 个条目)" -ForegroundColor Green
Write-Host "下一步: 将 tar 包与 deploy.sh 上传服务器后在服务器执行: sudo bash deploy.sh <域名>"
