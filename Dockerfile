# ── Build stage: install everything, build the client, type-check ──────────
FROM node:22-slim AS build

# Toolchain fallback for better-sqlite3 in case no prebuilt binary matches.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci

COPY shared/ shared/
COPY server/ server/
COPY client/ client/
RUN npm run build -w client && npm run build -w server

# Drop dev dependencies (vite, vitest, typescript...) for the runtime image.
RUN npm prune --omit=dev

# ── Runtime stage: server + built client + prod deps only ───────────────────
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=3001 \
    DB_PATH=/data/league.db

WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared ./shared
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist

# The SQLite database lives on a volume so upgrades keep league history.
RUN mkdir -p /data
VOLUME /data

EXPOSE 3001
CMD ["./node_modules/.bin/tsx", "server/src/index.ts"]
