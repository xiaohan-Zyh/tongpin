import 'server-only';

import type { NextRequest } from 'next/server';

/**
 * 解析当前请求的真实 origin。
 *
 * 不能直接使用 `request.nextUrl.origin`：Next.js 在某些运行模式下会把它
 * 规范化成 `localhost`，导致从 `127.0.0.1` 访问时重定向后主机名改变，
 * 浏览器因同源策略不再回传 HttpOnly 会话 Cookie，表现为「登录成功却仍未登录」。
 *
 * 这里优先采用反向代理头，其次采用请求 Host 头，保证重定向始终落在
 * 用户当前实际访问的主机上。
 */
export function resolveOrigin(request: NextRequest): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const host = forwardedHost ?? request.headers.get('host');

  if (!host) return request.nextUrl.origin;

  const proto =
    forwardedProto?.split(',')[0]?.trim() ??
    (host.startsWith('localhost') || host.startsWith('127.0.0.1')
      ? 'http'
      : 'https');

  return `${proto}://${host}`;
}
