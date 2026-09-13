import { NextResponse, type NextRequest } from 'next/server';

import { ZhihuApiError, fetchHotList } from '@/lib/zhihu';

/** GET /api/hot?limit=30 —— 知乎热榜 */
export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 30;

  try {
    const data = await fetchHotList(Number.isNaN(limit) ? 30 : limit);
    return NextResponse.json({
      total: data.Total,
      items: data.Items ?? [],
    });
  } catch (err) {
    if (err instanceof ZhihuApiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === 20001 ? 401 : 502 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '获取热榜失败' },
      { status: 500 },
    );
  }
}
