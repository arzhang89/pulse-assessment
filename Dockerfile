# syntax=docker/dockerfile:1

# Single Dockerfile, two runtime images (web, worker), built from the same
# source revision and the same package-lock.json so both processes always
# run dependency-identical code.

# Pin the same Node patch as .nvmrc so local and container builds share
# one known-good 22.x release (meets package.json engines >=22.18.0).
FROM node:22.23.0-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the "postinstall" hook runs `nuxt prepare`, which needs
# the Nuxt app source (nuxt.config.ts, app/, ...) that isn't copied in yet
# at this point. It's run explicitly in the "build" stage instead, once
# the full source is present.
RUN npm ci --ignore-scripts

FROM base AS build
COPY . .
RUN npx nuxt prepare
RUN npm run build
RUN npm run worker:build

# --- web ---
# Nuxt's Nitro "node-server" output (.output) is self-contained: it
# bundles the server runtime and its production dependencies, so no
# npm install is needed in this stage.
FROM node:22.23.0-alpine AS web
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]

# --- worker ---
# Standalone worker: compiled JS plus only its production dependencies
# (pg, drizzle-orm, zod). --ignore-scripts skips the Nuxt postinstall
# hook, which this image has no use for.
FROM node:22.23.0-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist-worker ./dist-worker
CMD ["node", "dist-worker/worker/src/index.js"]
