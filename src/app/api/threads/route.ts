import { NextResponse } from 'next/server';

import { currentUser, unauthorized } from '@/lib/api';
import { listThreads } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** GET /api/threads —— 我的对话列表 */
export async function GET() {
  const user = await currentUser();
  if (!user) return unauthorized();

  return NextResponse.json({ items: await listThreads(user.id) });
}
