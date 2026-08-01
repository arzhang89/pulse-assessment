# syntax=docker/dockerfile:1

# Single Dockerfile, three runtime images (web, worker, migrate), built from
# the same source revision and package-lock.json.

FROM node:22.23.0-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: postinstall runs `nuxt prepare`, which needs full source.
RUN npm ci --ignore-scripts

FROM base AS build
COPY . .
RUN npx nuxt prepare
RUN npm run build
RUN npm run worker:build

# --- web ---
# Nitro node-server output is self-contained.
FROM node:22.23.0-alpine AS web
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", ".output/server/index.mjs"]

# --- worker ---
FROM node:22.23.0-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && chown -R node:node /app
COPY --from=build --chown=node:node /app/dist-worker ./dist-worker
USER node
CMD ["node", "dist-worker/worker/src/index.js"]

# --- migrate ---
# Production migrator only: drizzle-orm migrator + compiled runner + SQL files.
# Does not install or invoke drizzle-kit.
FROM node:22.23.0-alpine AS migrate
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && chown -R node:node /app
COPY --from=build --chown=node:node /app/dist-worker/db ./dist-worker/db
COPY --from=build --chown=node:node /app/dist-worker/shared ./dist-worker/shared
COPY --chown=node:node db/migrations ./db/migrations
USER node
CMD ["node", "dist-worker/db/migrate.js"]
