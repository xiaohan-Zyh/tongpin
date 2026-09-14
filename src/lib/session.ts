import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

import { getSessionSecret } from '@/config/zhihu';
import { consumeStateOnce } from '@/lib/state-store';
import type { SessionPayload, SessionUser } from '@/lib/types';

/**
 * 极简会话实现：HMAC-SHA256 签名的 HttpOnly Cookie。
 *
 * 安全取舍：
 *   - OAuth access_token 只存在服务端可读的 HttpOnly Cookie 中，
 *     浏览器 JS 无法读取，也不会出现在任何前端产物或 URL 里；
 *   - Cookie 带签名，防止客户端伪造用户身份；
 *   - 生产环境（HTTPS）自动加 Secure 标记。
 */

const SESSION_COOKIE = 'zhihu_session';
const OAUTH_STATE_COOKIE = 'zhihu_oauth_state';
/** OAuth state 有效期：10 分钟 */
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function sign(value: string): string {
  return createHmac('sha256', getSessionSecret())
    .update(value)
    .digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function serialize(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

function deserialize(raw: string): SessionPayload | null {
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);

  if (!safeEqual(signature, sign(body))) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as SessionPayload;

    if (!parsed.accessToken || !parsed.user) return null;
    if (typeof parsed.expiresAt === 'number' && parsed.expiresAt < Date.now()) {
      // token 已过期，视为未登录，不静默降级到其他身份
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** 写入登录会话 */
export async function createSession(params: {
  user: SessionUser;
  accessToken: string;
  expiresIn: number;
}): Promise<void> {
  const payload: SessionPayload = {
    user: params.user,
    accessToken: params.accessToken,
    expiresAt: Date.now() + params.expiresIn * 1000,
  };

  const store = await cookies();
  store.set(SESSION_COOKIE, serialize(payload), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: params.expiresIn,
  });
}

/** 读取当前会话，未登录或已过期时返回 null */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  return deserialize(raw);
}

/** 只读取可以安全暴露给前端的用户资料，不含 token */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getSession();
  return session?.user ?? null;
}

/** 清除会话 */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * 写入 OAuth state，用于回调时校验请求关联性（防登录 CSRF）。
 *
 * 黑客松 OAuth 服务已支持 state 原样透传，因此这里做标准的往返比对：
 * state 经签名后绑定当前浏览器会话，有效期 10 分钟。
 */
export async function setOAuthState(state: string): Promise<void> {
  const store = await cookies();
  const body = Buffer.from(
    JSON.stringify({ state, expiresAt: Date.now() + OAUTH_STATE_TTL_MS }),
  ).toString('base64url');

  store.set(OAUTH_STATE_COOKIE, `${body}.${sign(body)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: OAUTH_STATE_TTL_MS / 1000,
  });
}

/**
 * 原子消费并校验回调带回的 state。
 *
 * 校验规则：签名有效、未过期、与回调值完全一致。无论成功或失败都立即
 * 删除 Cookie，防止同一个 state 被重复回调复用。
 */
export async function verifyAndConsumeOAuthState(
  returnedState: string | undefined,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const store = await cookies();
  const raw = store.get(OAUTH_STATE_COOKIE)?.value;

  // 一次性消费：先删除，再校验
  store.delete(OAUTH_STATE_COOKIE);

  if (!raw) {
    return { ok: false, reason: '授权会话不存在或已被使用，请重新发起登录。' };
  }
  if (!returnedState) {
    return { ok: false, reason: '回调缺少 state 参数，已拒绝本次登录。' };
  }

  const dot = raw.lastIndexOf('.');
  if (dot <= 0) {
    return { ok: false, reason: '授权会话格式不合法，已拒绝本次登录。' };
  }

  const body = raw.slice(0, dot);
  if (!safeEqual(raw.slice(dot + 1), sign(body))) {
    return { ok: false, reason: '授权会话签名校验失败，已拒绝本次登录。' };
  }

  let saved: { state?: string; expiresAt?: number };
  try {
    saved = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: '授权会话解析失败，已拒绝本次登录。' };
  }

  if (typeof saved.expiresAt !== 'number' || saved.expiresAt < Date.now()) {
    return { ok: false, reason: '授权请求已超时，请重新发起登录。' };
  }
  if (!saved.state || !safeEqual(saved.state, returnedState)) {
    return { ok: false, reason: 'state 校验不通过，已拒绝本次登录。' };
  }

  // 服务端一次性消费：仅删除 Cookie 不足以防重放，攻击者可能同时持有
  // state 与对应 Cookie 并重复提交授权码。
  if (!(await consumeStateOnce(saved.state, OAUTH_STATE_TTL_MS))) {
    return { ok: false, reason: '该授权请求已被使用，请重新发起登录。' };
  }

  return { ok: true };
}
