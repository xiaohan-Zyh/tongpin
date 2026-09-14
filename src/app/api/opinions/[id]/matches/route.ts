import { NextResponse, type NextRequest } from 'next/server';

import { currentUser, notFound, unauthorized } from '@/lib/api';
import { findMatches, getOpinion } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/opinions/[id]/matches —— 为已发表的观点查找相似观点
 *
 * 支持用户在发表当时不匹配，之后再回来主动匹配。
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return unauthorized();

  const { id } = await params;

  const opinion = await getOpinion(id);
  if (!opinion) return notFound('观点不存在或已被删除。');
  if (opinion.authorId !== user.id) {
    return NextResponse.json(
      { error: '只能为自己的观点查找匹配。' },
      { status: 403 },
    );
  }
  if (opinion.visibility !== 'public') {
    return NextResponse.json(
      {
        error:
          '该观点当前仅自己可见，未进入匹配池。切换为公开后即可查找相似观点。',
      },
      { status: 409 },
    );
  }

  const matches = await findMatches(id, user.id);

  return NextResponse.json({
    matches,
    note:
      matches.length === 0
        ? '暂时没有找到相近的观点，之后仍可能被其他人匹配到。'
        : null,
  });
}
