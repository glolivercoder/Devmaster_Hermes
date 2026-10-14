# ─── HERMES CONTROL CENTER CONTAINER ───────────────────────────
# Multi-stage lightweight build optimized for low-resource environments (Ryzen 5600 / 24GB RAM)
FROM node:22-alpine AS builder

WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate

# Copy manifest files
COPY package.json pnpm-lock.yaml tsconfig.json ./

# Install dependencies (frozen-lockfile for consistency)
RUN pnpm install --frozen-lockfile

# Copy source code and registry
COPY src ./src
COPY mcp-registry.json ./
COPY litellm-config.yaml ./

# Build TypeScript to dist
RUN pnpm build || npx tsc -p tsconfig.json

# ─── RUNNER STAGE (Minimal Alpine image) ─────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install net-tools for netstat port scanning inside the container
RUN apk add --no-cache curl net-tools

# Enable pnpm for runtime
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate

# Copy production packages & artifacts
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/mcp-registry.json ./
COPY --from=builder /app/src/ui ./src/ui

EXPOSE 4010 4020

CMD ["node", "dist/index.js"]
