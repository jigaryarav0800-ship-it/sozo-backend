# ── Stage 1: install dependencies ─────────────────────────────────────────────
FROM node:22-slim AS deps

WORKDIR /app
COPY package.json package-lock.json* ./

# canvas uchun build toollar
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev && \
    rm -rf /var/lib/apt/lists/*

RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi && \
    npm cache clean --force

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:22-slim AS runner

# canvas runtime kutubxonalari
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
    curl dumb-init && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Non-root user
RUN groupadd -r soplay && useradd -r -g soplay -s /bin/false soplay

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN chown -R soplay:soplay /app
USER soplay

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:3000/health || exit 1

# dumb-init PID 1 muammosini hal qiladi (graceful shutdown)
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
