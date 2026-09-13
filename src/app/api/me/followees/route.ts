import { NextResponse, type NextRequest } from 'next/server';

import { getSession } from '@/lib/session';
import { ZhihuApiError, fetchUserFollowees } from '@/lib/zhihu';

export const dynamic = 'force-dynamic';

/**
 * GET /api/me/followees?offset=0&limit=10
 * 返回当前登录用户关注的人，供「加载更多」使用。
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
    const result = await fetchUserFollowees({
      oauthToken: session.accessToken,
      offset: Number.isNaN(offset) ? 0 : offset,
      limit: Number.isNaN(limit) ? 10 : limit,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ZhihuApiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === 20001 ? 401 : 502 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '获取关注列表失败' },
      { status: 500 },
    );
  }
}
