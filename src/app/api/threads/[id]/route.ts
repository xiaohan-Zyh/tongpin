import { NextResponse, type NextRequest } from 'next/server';

import { badRequest, currentUser, notFound, readJson, unauthorized } from '@/lib/api';
import { listMessages, sendMessage } from '@/lib/store';

export const dynamic = 'force-dynamic';

const MAX_MESSAGE = 1000;

/** GET /api/threads/[id] —— 读取对话消息 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return unauthorized();

  const { id } = await params;
  const data = await listMessages(id, user.id);
  // 非会话成员一律按「不存在」处理，不泄露会话是否存在
  if (!data) return notFound('对话不存在或你无权访问。');

  return NextResponse.json(data);
}

interface Body {
  content?: string;
}

/** POST /api/threads/[id] —— 发送消息 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await currentUser();
  if (!user) return unauthorized();

  const body = await readJson<Body>(request);
  const content = (body?.content ?? '').trim();
  if (!content) return badRequest('消息内容不能为空。');
  if (content.length > MAX_MESSAGE) {
    return badRequest(`消息请控制在 ${MAX_MESSAGE} 字以内。`);
  }

  const { id } = await params;
  const message = await sendMessage({ threadId: id, sender: user, content });
  if (!message) return notFound('对话不存在或你无权访问。');

  return NextResponse.json({ message });
}
