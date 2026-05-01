# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV npm_config_store_dir=/app/.pnpm-store

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml .npmrc ./
COPY template/react-mui-app/package.json template/react-mui-app/pnpm-lock.yaml template/react-mui-app/.npmrc ./template/react-mui-app/
COPY template/react-tailwind-app/package.json template/react-tailwind-app/pnpm-lock.yaml template/react-tailwind-app/.npmrc ./template/react-tailwind-app/

RUN pnpm install --frozen-lockfile --ignore-scripts --store-dir /app/.pnpm-store \
  && pnpm --dir template/react-mui-app install --frozen-lockfile --ignore-scripts --store-dir /app/.pnpm-store \
  && pnpm --dir template/react-tailwind-app install --frozen-lockfile --ignore-scripts --store-dir /app/.pnpm-store

FROM deps AS build
WORKDIR /app

COPY . .

RUN pnpm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  HOME=/workspace \
  PLAYWRIGHT_BROWSERS_PATH=/opt/workspace-dev/.cache/ms-playwright \
  npm_config_store_dir=/opt/workspace-dev/.pnpm-store \
  FIGMAPIPE_WORKSPACE_HOST=0.0.0.0 \
  FIGMAPIPE_WORKSPACE_PORT=1983 \
  FIGMAPIPE_WORKSPACE_OUTPUT_ROOT=/workspace/.workspace-dev \
  FIGMAPIPE_WORKSPACE_LOG_FORMAT=json

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate \
  && groupadd --system workspace-dev \
  && useradd --system --gid workspace-dev --home-dir /workspace --create-home workspace-dev \
  && mkdir -p /opt/workspace-dev \
  && mkdir -p /workspace/.workspace-dev \
  && chown -R workspace-dev:workspace-dev /opt/workspace-dev /workspace

WORKDIR /opt/workspace-dev

COPY --from=deps --chown=workspace-dev:workspace-dev /app/.pnpm-store ./.pnpm-store
COPY --from=deps --chown=workspace-dev:workspace-dev /app/template/react-mui-app/node_modules ./template/react-mui-app/node_modules
COPY --from=deps --chown=workspace-dev:workspace-dev /app/template/react-tailwind-app/node_modules ./template/react-tailwind-app/node_modules
COPY --from=build --chown=workspace-dev:workspace-dev /app/dist ./dist
COPY --from=build --chown=workspace-dev:workspace-dev /app/template ./template
COPY --from=build --chown=workspace-dev:workspace-dev /app/package.json /app/README.md ./

RUN mkdir -p /opt/workspace-dev/.cache/ms-playwright \
  && pnpm --dir template/react-tailwind-app exec playwright install --with-deps chromium \
  && chown -R workspace-dev:workspace-dev /opt/workspace-dev/.cache/ms-playwright

RUN chmod +x /opt/workspace-dev/dist/cli.cjs \
  && ln -s /opt/workspace-dev/dist/cli.cjs /usr/local/bin/workspace-dev

USER workspace-dev
WORKDIR /workspace
EXPOSE 1983
VOLUME ["/workspace/.workspace-dev"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:1983/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["workspace-dev"]
CMD ["start"]
