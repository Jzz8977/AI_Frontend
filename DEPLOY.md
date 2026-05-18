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

---

# 宝塔(aaPanel)部署 — PM2 原生方式(前后端分开,推荐)

不用 Docker。后端 Node + PM2 守护,前端 `npm run build` 出静态文件挂宝塔站点,站点 nginx 反代 `/api` → 后端。**只有宝塔站点这一层 nginx**,SSE/长耗时配置只需配一处。

> 关键:前端代码用相对路径 `/api/...` 调接口,没有可配后端地址的变量。所以前端站点**必须**反代 `/api` 到后端,做成同域;不能简单地把前后端放两个互不相干的域名。

## 0. 宝塔装这些

- **Node 版本管理器** → 安装 **Node 22**(`server/package.json` 要求 `>=22`;better-sqlite3 预编译二进制按 Node 大版本匹配,版本错会 ABI 报错)。
- **PM2 管理器**(或用「Node 项目」功能,它底层就是 PM2)。
- **Nginx**(建站用)。

代码传到 `/www/wwwroot/resume-portal`(含 `server/` 和 `client/`)。

## 1. 后端(PM2,端口 3001)

```bash
cd /www/wwwroot/resume-portal/server
cp .env.example .env
vi .env          # 必填 JWT_SECRET、DEEPSEEK_API_KEY;PORT 保持 3001

# 用 Node 22 装依赖(better-sqlite3 会拉 linux-x64/node22 预编译二进制)
npm install --omit=dev
# 若 better-sqlite3 报需要编译:装工具链后重装
#   Ubuntu: apt install -y python3 make g++   |  CentOS: yum install -y python3 make gcc-c++
```

启动(二选一):

- **宝塔「Node 项目」**:添加项目 → 目录 `/www/wwwroot/resume-portal/server`,Node 版本 22,启动文件 `src/index.js`(或运行命令 `npm start`),端口 `3001`,开机自启 + 守护。
- **命令行 PM2**:
  ```bash
  cd /www/wwwroot/resume-portal/server
  pm2 start src/index.js --name resume-server
  pm2 save && pm2 startup     # 按提示执行它输出的那条命令
  ```

验证:`curl http://127.0.0.1:3001/api/health` 返回 `{"ok":true,...}`。

> **SQLite 权限**:`server/data.db`(含 `-wal`/`-shm`)由后端进程写。确保运行用户对 `server/` 可写:`chown -R www:www /www/wwwroot/resume-portal/server`。**重新部署别删 `data.db`**——用户/历史/项目全在里面;`.gitignore` 已忽略它,`git pull` 不会动它。

## 2. 前端(构建 → 静态站点)

```bash
cd /www/wwwroot/resume-portal/client
npm install                 # 需要 devDependencies(tsc/vite),别加 --omit=dev
npm run build               # 产物在 client/dist
# 小内存机器 tsc+vite 可能 OOM:先加 swap,或 NODE_OPTIONS=--max-old-space-size=1024 npm run build
```

> **「Node 项目」≠ 这个站点**:第 1 步建的 Node 项目只负责 PM2 跑后端(监听 3001),**反代不写在 Node 项目里**;它自动生成的 `listen 3001` 站点配置是死循环(nginx 代理给自己 + 抢端口),删掉/忽略。反代写在下面这个**独立的静态站点**上。
>
> **三个地方别搞混**:`伪静态` 只放 SPA 的 `try_files`;`/api` 反代写在 `配置文件`(或「反向代理」标签页,二选一,别同时);后端 Node 项目里啥代理都不配。

宝塔 → 网站 → 添加站点:域名填你的域名或服务器 IP;PHP 版本选 **纯静态**;不建数据库。然后:

1. **运行目录**:站点设置 → 网站目录 → 运行目录 指到 `/www/wwwroot/resume-portal/client/dist`。
2. **伪静态**(站点设置 → 伪静态,清空后只粘这个 —— SPA 路由刷新不 404):
   ```nginx
   location / {
       try_files $uri $uri/ /index.html;
   }
   ```
3. **反代**(站点设置 → 配置文件,在 `server { }` 内、`access_log` 那行之前,加这段)。深度编排单次可达 1~2 分钟、`auto` 是 SSE 流式,默认 buffering+60s 会流式空白/502,所以必须关 buffering、调长超时:
   ```nginx
   location ^~ /api/ {
       proxy_pass http://127.0.0.1:3001;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;

       proxy_http_version 1.1;
       proxy_set_header Connection '';
       proxy_buffering off;
       proxy_cache off;
       proxy_read_timeout 600s;
       proxy_send_timeout 600s;
   }
   ```
   `^~ /api/` 比伪静态的 `location /` 更优先命中,接口不会被回退成 `index.html`。保存后宝塔自动 reload。
   > 用「反向代理」标签页(代理目录 `/api`,目标 `http://127.0.0.1:3001`)也行,但宝塔生成的那段默认没关 buffering,还得再去改它生成的 conf 补上面那几行 —— 所以直接写「配置文件」更省事。两种方式**别同时用**(location 重复冲突)。
4. 申请 SSL(Let's Encrypt)→ 强制 HTTPS。防火墙只放 80/443,**3001 不对外**(仅 `127.0.0.1`)。

## 3. 更新流程

```bash
cd /www/wwwroot/resume-portal && git pull
cd server  && npm install --omit=dev && pm2 restart resume-server
cd ../client && npm install && npm run build      # dist 原地更新,站点自动生效
```

## 4. 排查

| 现象 | 原因 / 处理 |
|---|---|
| 启动即崩,better-sqlite3 ABI/NODE_MODULE_VERSION 报错 | Node 不是 22。用宝塔 Node 版本管理器切 22,删 `server/node_modules` 重装。 |
| 流式改写一直空白 / 深度编排 502 超时 | 反代没加 `proxy_buffering off` + 长 `proxy_read_timeout`(见 2.3)。 |
| 刷新 `/result` 等路由 404 | 站点没配 SPA `try_files … /index.html`(见 2.2)。 |
| 接口 404 / 跨域 | `/api` 反代没配或域名不同源。前端必须同域反代 `/api`(见开头)。 |
| 写库失败 / 登录注册报错 | `server/` 目录运行用户无写权限,`chown -R www:www`。 |
| 出站超时 | 服务器需能访问 `api.deepseek.com`(用 OpenRouter 时还有 `openrouter.ai`)。 |
