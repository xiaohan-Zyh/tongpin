import { NextResponse, type NextRequest } from 'next/server';

import { getSession } from '@/lib/session';
import { ZhihuApiError, fetchUserContents } from '@/lib/zhihu';

export const dynamic = 'force-dynamic';

/**
 * GET /api/me/contents?offset=0&limit=10&type=all
 * 返回当前登录用户的创作内容，供「加载更多」使用。
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: '未登录或授权已过期' }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const offset = Number.parseInt(sp.get('offset') ?? '0', 10);
  const limit = Number.parseInt(sp.get('limit') ?? '10', 10);

  try {
    const result = await fetchUserContents({
      oauthToken: session.accessToken,
      offset: Number.isNaN(offset) ? 0 : offset,
      limit: Number.isNaN(limit) ? 10 : limit,
      contentType: sp.get('type') ?? 'all',
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ZhihuApiError) {
      // 鉴权失败时明确返回 401，前端据此提示重新登录，不静默切换身份
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === 20001 ? 401 : 502 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '获取创作内容失败' },
      { status: 500 },
    );
  }
}
