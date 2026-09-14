import { NextResponse, type NextRequest } from 'next/server';

import {
  badRequest,
  currentUser,
  paged,
  readJson,
  readPaging,
  unauthorized,
} from '@/lib/api';
import {
  createOpinion,
  findMatches,
  listMyOpinions,
  listSquare,
  type Visibility,
} from '@/lib/store';

export const dynamic = 'force-dynamic';

const MAX_CONTENT = 1000;
const MAX_TOPIC = 30;

interface CreateBody {
  content?: string;
  topic?: string;
  visibility?: Visibility;
  /** 发表后是否立即匹配 */
  match?: boolean;
}

/**
 * POST /api/opinions —— 发表观点
 *
 * 可见性与「是否匹配」正交：
 *   - private 的内容永不进入匹配池，纯粹作为记录；
 *   - match=false 时直接发表，但只要是 public 就仍可被他人匹配到。
 */
export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return unauthorized();

  const body = await readJson<CreateBody>(request);
  if (!body) return badRequest('请求体不是合法的 JSON。');

  const content = (body.content ?? '').trim();
  if (!content) return badRequest('观点内容不能为空。');
  if (content.length > MAX_CONTENT) {
    return badRequest(`观点内容请控制在 ${MAX_CONTENT} 字以内。`);
  }

  const visibility: Visibility =
    body.visibility === 'private' ? 'private' : 'public';

  const opinion = await createOpinion({
    author: user,
    content,
    topic: (body.topic ?? '').trim().slice(0, MAX_TOPIC),
    visibility,
  });

  // 仅自己可见的内容不参与匹配，即使请求要求匹配也不执行
  const wantMatch = body.match === true && visibility === 'public';
  const matches = wantMatch ? await findMatches(opinion.id, user.id) : [];

  return NextResponse.json({
    opinion,
    matched: wantMatch,
    matches,
    // 要求匹配但无结果时给出明确说明，而不是留一片空白
    note:
      wantMatch && matches.length === 0
        ? '暂时没有找到相近的观点。你的内容已发表，之后仍可能被其他人匹配到。'
        : null,
  });
}

/**
 * GET /api/opinions?scope=mine|square
 *   mine   我的全部观点（含仅自己可见）
 *   square 公开广场（排除自己）
 */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return unauthorized();

  const sp = request.nextUrl.searchParams;
  const { offset, limit } = readPaging(sp);

  const { items, total } =
    sp.get('scope') === 'square'
      ? await listSquare(user.id, offset, limit)
      : await listMyOpinions(user.id, offset, limit);

  return NextResponse.json(paged(items, offset, total));
}
