# Resume-rewriter backend (Express + better-sqlite3 + Mastra).
# better-sqlite3 ships prebuilt binaries for linux-x64 / node 22, so
# prebuild-install fetches them at `npm ci` — no apt/toolchain needed.
FROM node:22-bookworm-slim AS base
WORKDIR /app

# Install deps first for layer caching.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY src ./src

# SQLite lives on a mounted volume so data survives container restarts.
ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/data/data.db
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3001
CMD ["node", "src/index.js"]
