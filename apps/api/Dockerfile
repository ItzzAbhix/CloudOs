FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
RUN npm ci

COPY apps/api ./apps/api
COPY data ./data
RUN npm run build -w @cloudos/api

FROM node:22-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci --omit=dev --workspace @cloudos/api

COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/data ./data

CMD ["node", "apps/api/dist/index.js"]
