# 部署(Docker)

一键起前后端,SQLite 数据持久化到命名卷。

## 步骤

```bash
# 1. 准备后端环境变量(至少填 JWT_SECRET 和 DEEPSEEK_API_KEY)
cp server/.env.example server/.env
$EDITOR server/.env

# 2. 构建并启动
docker compose up -d --build

# 3. 打开
open http://localhost:8080
```

## 结构

- **server** 容器:Node 22 + Express + better-sqlite3 + Mastra。
  - 不联网装系统编译链:better-sqlite3 走 linux-x64/node22 预编译二进制。
  - `DB_PATH=/data/data.db`,挂命名卷 `rr-data`,容器重启/重建数据不丢(已验证 `docker compose restart server` 后用户仍可登录)。
  - 仅 `expose 3001`,不对宿主开端口,只经 client 的 nginx 反代访问。
- **client** 容器:Vite 构建产物用 nginx 托管,宿主 `8080:80`。
  - `/` → SPA(react-router,`try_files … /index.html`)。
  - `/api/` → 反代 `http://server:3001`;对 SSE(`/api/rewrite/stream`)与长耗时 `/api/orchestrate`(深度编排可串多次模型调用)关闭 buffering、`proxy_read_timeout 600s`。

## 常用命令

```bash
docker compose logs -f server      # 看后端日志
docker compose restart server      # 重启后端(数据不丢)
docker compose down                # 停止(保留数据卷 rr-data)
docker compose down -v             # 停止并删除数据卷(清空所有用户/历史)
```

环境变量见 `server/.env.example`。`server/.env` 不入镜像(`.dockerignore`),由 compose `env_file` 注入。
