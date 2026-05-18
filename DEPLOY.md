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

---

# 宝塔(aaPanel)部署 — Docker 管理器方式

复用上面同一套 `docker-compose.yml`,宝塔只负责装 Docker、托管 compose、做带域名/SSL 的反代。

## 1. 装插件

宝塔面板 → 软件商店 → 安装 **Docker 管理器**(会自动装 Docker + Compose v2)。

## 2. 上传代码 + 配 env

```bash
# SSH 或宝塔「终端」
cd /www/wwwroot
git clone <你的仓库> resume-portal      # 或用宝塔文件管理上传整个项目
cd resume-portal
cp server/.env.example server/.env
vi server/.env                          # 必填 JWT_SECRET、DEEPSEEK_API_KEY
```

> better-sqlite3 在构建时拉 linux-x64/node22 **预编译二进制**,服务器需能联网访问 npm。国内服务器若拉取慢/失败:给 Docker 配镜像加速,或在 `server/Dockerfile` 的 `npm ci` 前加 `RUN npm config set registry https://registry.npmmirror.com`。

## 3. 起服务

- **宝塔 Docker 管理器 → Compose**:添加项目,目录选 `/www/wwwroot/resume-portal`,确认识别到 `docker-compose.yml`,点构建并启动。
- 或「终端」里:`cd /www/wwwroot/resume-portal && docker compose up -d --build`

> 宝塔若用的是老的 compose v1 报错(healthcheck 语法/无 version),在 `docker-compose.yml` 顶部加 `version: "3.8"`,或直接用命令行的 `docker compose`(v2)。

起来后:client 容器监听宿主 **8080**,server 容器仅内网(经 client 的 nginx 反代),SQLite 落在命名卷 `rr-data`。

## 4. 用宝塔站点做域名 + HTTPS 反代(关键)

不要直接对公网开 8080。宝塔 → 网站 → 添加站点(绑你的域名,纯反代可不建数据库)→ 该站点「反向代理」→ 目标 URL 填 `http://127.0.0.1:8080`。

⚠️ **这个项目特有的坑**:深度编排单次会串多次模型调用(可达 1~2 分钟),`auto` 改写是 SSE 流式。宝塔反代默认开 `proxy_buffering` 且超时 60s,会让**流式空白 / 深度编排 502 超时**。必须在该站点反代的「配置文件」里,`location` 段补上:

```nginx
proxy_buffering off;
proxy_cache off;
proxy_set_header Connection '';
proxy_http_version 1.1;
proxy_read_timeout 600s;
proxy_send_timeout 600s;
```

(容器内层 nginx 已配好这些;这里是宝塔**外层** nginx,必须同样放开,双层都对才行。)

然后该站点申请 Let's Encrypt 证书、开强制 HTTPS。防火墙/安全组放行 80/443,**不用**对外放 8080。

## 5. 运维

```bash
cd /www/wwwroot/resume-portal
git pull && docker compose up -d --build   # 更新
docker compose logs -f server              # 后端日志
docker compose restart server              # 重启(数据不丢)
docker run --rm -v resume-portal_rr-data:/d -v $PWD:/b alpine \
  sh -c 'cp /d/data.db* /b/'               # 备份 SQLite
```

出站需放行 `api.deepseek.com`(及用到 OpenRouter 时 `openrouter.ai`)。
