# syntax=docker/dockerfile:1

# 依赖层：安装全部依赖（含 devDependencies，供测试与构建使用）
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 构建层：类型检查 + 静态构建
FROM deps AS build
COPY . .
RUN npm run build

# 发布层：纯静态 Web（nginx），无业务后端
FROM nginx:1.27-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=5s --timeout=2s --start-period=5s --retries=10 \
  CMD wget -q -O /dev/null http://127.0.0.1/health || exit 1

# 核验层：一次性服务，跑完测试、构建检查与 HTTP 冒烟后自行退出
FROM deps AS verify
COPY . .
ENV WEB_URL=http://web
CMD ["node", "scripts/verify.mjs"]
