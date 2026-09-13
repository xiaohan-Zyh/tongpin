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
            'OAuth 应用凭据尚未配置，请在 src/config/zhihu.ts 或环境变量中填写赛事页面分配的 app_id 与 app_key。',
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
