import 'server-only';

import { NextResponse } from 'next/server';

import { getSession } from '@/lib/session';
import type { SessionUser } from '@/lib/types';

/** 接口层通用辅助，避免每个路由重复样板代码 */

export function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: '未登录或授权已过期，请重新登录。' },
    { status: 401 },
  );
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

/** 取出当前登录用户；未登录返回 null */
export async function currentUser(): Promise<SessionUser | null> {
  const session = await getSession();
  return session?.user ?? null;
}

/** 安全解析 JSON 请求体 */
export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/** 解析分页参数 */
export function readPaging(sp: URLSearchParams): {
  offset: number;
  limit: number;
} {
  const offset = Math.max(Number.parseInt(sp.get('offset') ?? '0', 10) || 0, 0);
  const limit = Math.min(
    Math.max(Number.parseInt(sp.get('limit') ?? '10', 10) || 10, 1),
    50,
  );
  return { offset, limit };
}

/** 构造统一分页响应 */
export function paged<T>(items: T[], offset: number, total: number) {
  const next = offset + items.length;
  const isEnd = next >= total;
  return { items, isEnd, nextOffset: isEnd ? null : next, total };
}
