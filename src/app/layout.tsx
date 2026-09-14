import type { Metadata } from 'next';

import UserMenu from '@/components/UserMenu';
import { getSessionUser } from '@/lib/session';

import './globals.css';

export const metadata: Metadata = {
  title: '同频',
  description: '写下你的观点，找到想法相似的人',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 仅取可公开的用户资料，OAuth token 不会离开服务端
  const user = await getSessionUser();

  return (
    <html lang="zh-CN">
      <body>
        <header className="site-header">
          <div className="site-header__inner">
            <a href="/tongpin" className="site-header__brand">
              同频
            </a>
            <nav className="site-header__nav">
              <a href="/tongpin">同频</a>
              {user && <a href="/me">我的</a>}
            </nav>
            <UserMenu user={user} />
          </div>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
