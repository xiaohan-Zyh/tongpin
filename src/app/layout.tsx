import type { Metadata } from 'next';

import UserMenu from '@/components/UserMenu';
import { getSessionUser } from '@/lib/session';

import './globals.css';

export const metadata: Metadata = {
  title: '知乎热榜 · Next.js 全栈示例',
  description: '基于知乎开放平台的热榜展示与 OAuth 登录示例应用',
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
            <a href="/" className="site-header__brand">
              知乎热榜
            </a>
            <nav className="site-header__nav">
              <a href="/">热榜</a>
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
