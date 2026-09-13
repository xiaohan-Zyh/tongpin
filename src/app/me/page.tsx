import { redirect } from 'next/navigation';

import ProfileTabs from '@/components/ProfileTabs';
import { Avatar } from '@/components/UserMenu';
import { getSessionUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function MePage() {
  const user = await getSessionUser();

  // 未登录直接引导去授权
  if (!user) {
    redirect('/api/auth/login');
  }

  return (
    <>
      {/* 上半部分：用户信息 */}
      <section className="card profile">
        <Avatar user={user} size="lg" />
        <div>
          <h1 className="profile__name">{user.name}</h1>
          <p className="profile__headline">
            {user.headline || '这个人很懒，什么都没写'}
          </p>
          {user.url && (
            <a
              className="profile__link"
              href={user.url}
              target="_blank"
              rel="noreferrer"
            >
              在知乎查看主页 →
            </a>
          )}
        </div>
      </section>

      {/* 下半部分：关注的人 / 创作信息，支持加载更多 */}
      <ProfileTabs />
    </>
  );
}
