import { NextResponse, type NextRequest } from 'next/server';

import { badRequest, currentUser, notFound, readJson, unauthorized } from '@/lib/api';
import { updateVisibility, type Visibility } from '@/lib/store';

export const dynamic = 'force-dynamic';

interface Body {
  visibility?: Visibility;
}

/**
 * PATCH /api/opinions/[id] —— 切换可见性
 *
 * 已发表的内容可随时在「公开（可被匹配）」与「仅自己可见」间切换。
 * 仅作者本人可操作。
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return unauthorized();

  const body = await readJson<Body>(request);
  if (!body) return badRequest('请求体不是合法的 JSON。');
  if (body.visibility !== 'public' && body.visibility !== 'private') {
    return badRequest('visibility 只能是 public 或 private。');
  }

  const { id } = await params;
  const updated = await updateVisibility(id, user.id, body.visibility);
  if (!updated) return notFound('观点不存在，或你不是该内容的作者。');

  return NextResponse.json({ opinion: updated });
}
