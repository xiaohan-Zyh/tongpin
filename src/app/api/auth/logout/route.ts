import { NextResponse, type NextRequest } from 'next/server';

import { resolveOrigin } from '@/lib/request';
import { destroySession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** POST /api/auth/logout —— 清除本地会话 */
export async function POST(request: NextRequest) {
  await destroySession();
  return NextResponse.redirect(new URL('/', resolveOrigin(request)), {
    status: 303,
  });
}
