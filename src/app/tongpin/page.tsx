import { redirect } from 'next/navigation';

import TongpinWorkspace from '@/components/TongpinWorkspace';
import { getSessionUser } from '@/lib/session';
import { getBadges } from '@/lib/store';

export const dynamic = 'force-dynamic';

export default async function TongpinPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  const user = await getSessionUser();

  // 未登录引导去授权；「同频」的全部能力都需要身份
  if (!user) redirect('/api/auth/login');

  const { topic } = await searchParams;

  return (
    <TongpinWorkspace
      user={user}
      initialBadges={getBadges(user.id)}
      initialTopic={topic ?? ''}
    />
  );
}
