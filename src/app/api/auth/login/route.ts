import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

import { isOAuthConfigured } from '@/config/zhihu';
import { resolveOrigin } from '@/lib/request';
import { setOAuthState } from '@/lib/session';
import { buildAuthorizeUrl } from '@/lib/zhihu';

export const dynamic = 'force-dynamic';

/** GET /api/auth/login —— 生成 state 并跳转到知乎授权页 */
export async function GET(request: NextRequest) {
  const origin = resolveOrigin(request);

  if (!isOAuthConfigured()) {
    return NextResponse.redirect(
      new URL(
        '/login-error?reason=' +
          encodeURIComponent(
            'OAuth 应用凭据尚未配置。请设置环境变量 ZHIHU_OAUTH_APP_ID 与 ZHIHU_OAUTH_APP_KEY（本地写入 .env.local，线上在 Vercel 环境变量中配置）。',
          ),
        origin,
      ),
    );
  }

  // 使用密码学安全随机数生成不可预测的 state，并绑定当前浏览器会话
  const state = randomBytes(32).toString('base64url');
  await setOAuthState(state);

  return NextResponse.redirect(buildAuthorizeUrl(state));
}
