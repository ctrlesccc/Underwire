# syntax=docker/dockerfile:1.7

# ---------- base ----------
FROM node:20-bookworm-slim AS base
WORKDIR /app

# ---------- deps ----------
FROM base AS deps
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --no-audit --no-fund

# ---------- builder ----------
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- runner ----------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# requires next.config.js => { output: 'standalone' }
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
