'use client';

import { useEffect, useRef, useState } from 'react';

import type { SessionUser } from '@/lib/types';

/** 头像：有图用图，无图用昵称首字生成色块，避免出现破图 */
function Avatar({
  user,
  size = 'sm',
}: {
  user: SessionUser;
  size?: 'sm' | 'lg';
}) {
  const className = size === 'lg' ? 'avatar avatar--lg' : 'avatar';

  if (user.avatarUrl) {
    // 知乎图片域名众多且带防盗链参数，这里用原生 img 以规避 next/image 的域名白名单限制
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={className} src={user.avatarUrl} alt={user.name} />;
  }

  const initial = user.name.trim().charAt(0) || '知';
  return (
    <span className={className} aria-hidden="true">
      {initial}
    </span>
  );
}

export { Avatar };

/**
 * 右上角用户入口。
 * 未登录显示「知乎登录」按钮，已登录显示头像 + 昵称，点击展开菜单进入用户页。
 */
export default function UserMenu({ user }: { user: SessionUser | null }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击外部与 Esc 关闭菜单
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) {
    return (
      <a href="/api/auth/login">
        <button type="button" className="login-button">
          知乎登录
        </button>
      </a>
    );
  }

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        type="button"
        className="user-menu__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="打开用户菜单"
      >
        <Avatar user={user} />
        <span className="user-menu__name">{user.name}</span>
      </button>

      {open && (
        <div className="user-menu__panel" role="menu">
          <a className="user-menu__item" href="/me" role="menuitem">
            我的主页
          </a>
          <a className="user-menu__item" href="/tongpin" role="menuitem">
            同频 · 我的记录
          </a>
          {user.url && (
            <a
              className="user-menu__item"
              href={user.url}
              target="_blank"
              rel="noreferrer"
              role="menuitem"
            >
              在知乎查看
            </a>
          )}
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="user-menu__item user-menu__item--danger"
              role="menuitem"
            >
              退出登录
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
