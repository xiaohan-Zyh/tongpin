import { NextResponse, type NextRequest } from 'next/server';

import { resolveOrigin } from '@/lib/request';
import { createSession, verifyAndConsumeOAuthState } from '@/lib/session';
import { exchangeCodeForToken, fetchOAuthUserProfile } from '@/lib/zhihu';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/callback —— 知乎授权回调
 *
 * 协议要点：
 *   - 回调参数名是 authorization_code；为兼容协议修订同时接受 code；
 *   - 黑客松 OAuth 支持 state 透传，必须在换取 Token 之前完成校验并原子消费；
 *   - app_key 与 Token 交换全程在服务端完成，不经过浏览器。
 */
export async function GET(request: NextRequest) {
  const origin = resolveOrigin(request);
  const params = request.nextUrl.searchParams;

  const fail = (reason: string) =>
    NextResponse.redirect(
      new URL(`/login-error?reason=${encodeURIComponent(reason)}`, origin),
    );

  // 授权页可能回传错误信息
  const error = params.get('error') ?? params.get('error_description');
  if (error) return fail(`知乎返回授权错误：${error}`);

  const code =
    params.get('authorization_code') ?? params.get('code') ?? undefined;

  // 先校验 state 并原子消费，通过后才继续交换 Token
  const stateResult = await verifyAndConsumeOAuthState(
    params.get('state') ?? undefined,
  );
  if (!stateResult.ok) return fail(stateResult.reason);

  if (!code) {
    return fail('回调缺少 authorization_code 参数，授权未完成。');
  }

  try {
    const { accessToken, expiresIn } = await exchangeCodeForToken(code);

    const profile = await fetchOAuthUserProfile(accessToken);
    if (!profile) {
      // 鉴权失败或未取到有效用户标识时停止建立会话，不使用空对象登录
      return fail(
        '已获取授权，但读取用户基础信息失败，请稍后重试或重新登录。',
      );
    }

    await createSession({ accessToken, expiresIn, user: profile });

    return NextResponse.redirect(new URL('/me', origin));
  } catch (err) {
    const message =
      err instanceof Error ? err.message : '换取 access_token 时发生未知错误';
    return fail(message);
  }
}
