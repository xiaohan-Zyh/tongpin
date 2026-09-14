/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * standalone 模式：构建产物自带精简版 node_modules 与启动脚本，
   * 容器镜像无需完整依赖，体积大幅减小，启动更快。
   * CloudBase 云托管等容器化部署需要此配置。
   */
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.zhimg.com' },
      { protocol: 'https', hostname: '**.zhihu.com' },
    ],
  },
};

export default nextConfig;
