# CloudBase 云托管部署镜像
#
# 采用多阶段构建：依赖安装、编译、运行三层分离，
# 最终镜像只包含运行所需文件，体积小、启动快、攻击面更小。
#
# 依赖 next.config.mjs 中的 output: 'standalone' 配置。

# ---------- 阶段一：安装依赖 ----------
FROM node:20-alpine AS deps
WORKDIR /app

# 仅复制依赖清单，利用 Docker 层缓存：
# 依赖未变时跳过重装，大幅加快后续构建
COPY package.json package-lock.json ./

# npm ci 严格按 lock 文件安装，保证构建可复现
# 需要 devDependencies（TypeScript 等）才能完成构建
RUN npm ci --include=dev

# ---------- 阶段二：构建 ----------
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 关闭遥测，避免构建期外网请求拖慢或失败
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# ---------- 阶段三：运行 ----------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# 以非 root 用户运行，降低容器逃逸风险
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# standalone 产物已包含精简 node_modules 与 server.js
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

# CloudBase 云托管默认监听 80 端口
EXPOSE 80
ENV PORT=80
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
