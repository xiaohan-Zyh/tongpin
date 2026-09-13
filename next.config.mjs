/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.zhimg.com' },
      { protocol: 'https', hostname: '**.zhihu.com' },
    ],
  },
};

export default nextConfig;
