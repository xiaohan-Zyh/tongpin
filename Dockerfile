# CloudBase 云托管部署镜像
#
# 采用多阶段构建：依赖安装、编译、运行三层分离，
# 最终镜像只包含运行所需文件，体积小、启动快、攻击面更小。
#
# 依赖 next.config.mjs 中的 output: 'standalone' 配置。
#
# 为什么用 slim（Debian/glibc）而不是 alpine（musl）：
# Next.js 的图片优化依赖 sharp，其预编译二进制默认针对 glibc。
# 在 alpine 上常因 musl 不兼容导致 server.js 启动即崩溃，
# 表现为容器反复重启（Back-off restarting failed container）。

# ---------- 阶段一：安装依赖 ----------
FROM node:20-slim AS deps
WORKDIR /app

# 仅复制依赖清单，利用 Docker 层缓存：
# 依赖未变时跳过重装，加快后续构建
COPY package.json package-lock.json ./

# npm ci 严格按 lock 文件安装，保证构建可复现
# 构建阶段需要 devDependencies（TypeScript 等）
RUN npm ci --include=dev

# ---------- 阶段二：构建 ----------
FROM node:20-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 关闭遥测，避免构建期外网请求拖慢或失败
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# ---------- 阶段三：运行 ----------
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# standalone 产物已包含精简 node_modules 与 server.js
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Next.js 运行时需要写入缓存目录（ISR、图片优化等）
RUN mkdir -p .next/cache

# 以 root 运行的原因（有意的权衡）：
# CloudBase 云托管会向容器注入自己的 PORT 环境变量，覆盖镜像内的设置。
# 当平台注入 PORT=80 时，非 root 用户无权绑定 1024 以下的特权端口，
# 会触发 `listen EACCES: permission denied 0.0.0.0:80` 并反复重启。
# 因此不切换到非特权用户，使容器能绑定平台指定的任意端口。
# 本服务不写宿主文件、不挂载敏感卷，该权衡对托管环境可接受。

# 不硬编码 PORT，交由平台注入；本地或未注入时回退 3000，
# 保证容器监听端口与平台转发端口始终一致。
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

CMD ["sh", "-c", "PORT=${PORT:-3000} node server.js"]
