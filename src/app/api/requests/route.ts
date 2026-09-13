import { NextResponse, type NextRequest } from 'next/server';

import { badRequest, currentUser, readJson, unauthorized } from '@/lib/api';
import { createRequest, listIncoming, listOutgoing } from '@/lib/store';

export const dynamic = 'force-dynamic';

const MAX_GREETING = 200;

interface Body {
  opinionId?: string;
  greeting?: string;
}

/**
 * POST /api/requests —— 发起交流请求
 *
 * 产品关键约束：匹配到观点不等于可以直接对话，必须由对方同意。
 * 在对方同意前，双方只看到文字，不构成打扰。
 */
export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return unauthorized();

  const body = await readJson<Body>(request);
  if (!body?.opinionId) return badRequest('缺少 opinionId。');

  const greeting = (body.greeting ?? '').trim().slice(0, MAX_GREETING);

  const result = createRequest({
    from: user,
    opinionId: body.opinionId,
    greeting,
  });

  if (!result.ok) return badRequest(result.reason);

  return NextResponse.json({ request: result.request });
}

/** GET /api/requests?box=incoming|outgoing —— 交流请求列表 */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return unauthorized();

  const box = request.nextUrl.searchParams.get('box');
  const items =
    box === 'outgoing' ? listOutgoing(user.id) : listIncoming(user.id);

  return NextResponse.json({ items });
}
