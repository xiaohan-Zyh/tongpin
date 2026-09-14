import { NextResponse, type NextRequest } from 'next/server';

import { badRequest, currentUser, readJson, unauthorized } from '@/lib/api';
import { respondRequest } from '@/lib/store';

export const dynamic = 'force-dynamic';

interface Body {
  accept?: boolean;
}

/**
 * POST /api/requests/[id] —— 同意或拒绝交流请求
 *
 * 同意后创建对话线程，并把发起时的招呼语作为第一条消息。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return unauthorized();

  const body = await readJson<Body>(request);
  if (typeof body?.accept !== 'boolean') {
    return badRequest('accept 必须是布尔值。');
  }

  const { id } = await params;
  const result = await respondRequest({
    requestId: id,
    userId: user.id,
    accept: body.accept,
  });

  if (!result.ok) return badRequest(result.reason);

  return NextResponse.json({
    request: result.request,
    threadId: result.threadId,
  });
}
