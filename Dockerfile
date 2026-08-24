# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.4.1 --activate
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm check && pnpm build && pnpm prune --prod

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

RUN groupadd --system --gid 10001 turath \
    && useradd --system --uid 10001 --gid turath --home-dir /nonexistent turath

COPY --from=build --chown=turath:turath /app/dist ./dist
COPY --from=build --chown=turath:turath /app/node_modules ./node_modules
COPY --from=build --chown=turath:turath /app/package.json ./package.json

USER turath
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/index.js"]
