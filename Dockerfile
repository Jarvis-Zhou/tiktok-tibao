FROM node:22-bookworm-slim AS dependencies

WORKDIR /app
ENV NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# Install against manifests first so dependency downloads remain cached while
# application source changes. This repository intentionally does not ship a
# package-lock.json, so npm install is used instead of npm ci.
COPY package.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/ai-providers/package.json packages/ai-providers/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/tiktok-api/package.json packages/tiktok-api/package.json
COPY packages/video-core/package.json packages/video-core/package.json
COPY packages/video-worker/package.json packages/video-worker/package.json
RUN npm install

FROM dependencies AS build

COPY tsconfig.base.json ./
COPY apps/server/tsconfig.json apps/server/tsconfig.json
COPY apps/server/src apps/server/src
COPY apps/server/public apps/server/public
COPY packages/ai-providers/tsconfig.json packages/ai-providers/tsconfig.json
COPY packages/ai-providers/src packages/ai-providers/src
COPY packages/core/tsconfig.json packages/core/tsconfig.json
COPY packages/core/src packages/core/src
COPY packages/tiktok-api/tsconfig.json packages/tiktok-api/tsconfig.json
COPY packages/tiktok-api/src packages/tiktok-api/src
COPY packages/video-core/tsconfig.json packages/video-core/tsconfig.json
COPY packages/video-core/src packages/video-core/src
COPY packages/video-worker/tsconfig.json packages/video-worker/tsconfig.json
COPY packages/video-worker/src packages/video-worker/src

RUN npm run build --workspace @tibao/core \
    && npm run build --workspace @tibao/tiktok-api \
    && npm run build --workspace @tibao/video-core \
    && npm run build --workspace @tibao/ai-providers \
    && npm run build --workspace @tibao/video-worker \
    && npm run build --workspace @tibao/server \
    && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="Tibao" \
      org.opencontainers.image.description="TikTok Shop opportunity submission and ReCut Phase B video workspace"

ARG DEBIAN_MIRROR=http://deb.debian.org/debian
ARG DEBIAN_SECURITY_MIRROR=http://deb.debian.org/debian-security
ARG DEBIAN_FRONTEND=noninteractive

RUN sed -i \
      -e "s|http://deb.debian.org/debian-security|${DEBIAN_SECURITY_MIRROR}|g" \
      -e "s|http://deb.debian.org/debian|${DEBIAN_MIRROR}|g" \
      /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3210 \
    DATABASE_PATH=/data/tibao.sqlite \
    VIDEO_FEATURE_ENABLED=true \
    VIDEO_ALLOW_NON_LOOPBACK_HOST=true \
    VIDEO_STORAGE_DRIVER=local \
    VIDEO_STORAGE_ROOT=/data/video-assets \
    VIDEO_TEMP_ROOT=/data/video-tmp \
    VIDEO_WORKER_MODE=embedded \
    VIDEO_FFMPEG_PATH=/usr/bin/ffmpeg \
    VIDEO_FFPROBE_PATH=/usr/bin/ffprobe

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/server/package.json apps/server/package.json
COPY --from=build --chown=node:node /app/apps/server/dist apps/server/dist
COPY --from=build --chown=node:node /app/apps/server/public apps/server/public
COPY --from=build --chown=node:node /app/packages/ai-providers/package.json packages/ai-providers/package.json
COPY --from=build --chown=node:node /app/packages/ai-providers/dist packages/ai-providers/dist
COPY --from=build --chown=node:node /app/packages/core/package.json packages/core/package.json
COPY --from=build --chown=node:node /app/packages/core/dist packages/core/dist
COPY --from=build --chown=node:node /app/packages/tiktok-api/package.json packages/tiktok-api/package.json
COPY --from=build --chown=node:node /app/packages/tiktok-api/dist packages/tiktok-api/dist
COPY --from=build --chown=node:node /app/packages/video-core/package.json packages/video-core/package.json
COPY --from=build --chown=node:node /app/packages/video-core/dist packages/video-core/dist
COPY --from=build --chown=node:node /app/packages/video-worker/package.json packages/video-worker/package.json
COPY --from=build --chown=node:node /app/packages/video-worker/dist packages/video-worker/dist

RUN mkdir -p /data/video-assets /data/video-tmp \
    && chown -R node:node /data

USER node
VOLUME ["/data"]
EXPOSE 3210

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || '3210') + '/api/video/v1/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

ENTRYPOINT ["tini", "--"]
CMD ["node", "apps/server/dist/index.js"]
