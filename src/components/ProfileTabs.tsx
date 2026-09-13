'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';

import type { ContentItem, FolloweeItem, PagedResult } from '@/lib/types';

const PAGE_SIZE = 10;

type Tab = 'followees' | 'contents';

function formatDate(seconds: number): string {
  if (!seconds) return '';
  return new Date(seconds * 1000).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

const CONTENT_TYPE_LABEL: Record<string, string> = {
  answer: '回答',
  article: '文章',
  zvideo: '视频',
  pin: '想法',
  question: '提问',
};

function ContentRow({ item }: { item: ContentItem }) {
  return (
    <li className="list__row">
      <a href={item.Url} target="_blank" rel="noreferrer">
        <h3 className="content-item__title">
          <span className="badge">
            {CONTENT_TYPE_LABEL[item.ContentType] ?? item.ContentType}
          </span>
          {item.Title || '(无标题)'}
        </h3>
      </a>
      {item.Summary && <p className="content-item__summary">{item.Summary}</p>}
      <div className="content-item__meta">
        <span>{item.LikeCount} 赞同</span>
        <span>{item.CommentCount} 评论</span>
        <span>{item.FavoriteCount} 收藏</span>
        <span>{formatDate(item.CreatedAt)}</span>
      </div>
    </li>
  );
}

function FolloweeRow({ item }: { item: FolloweeItem }) {
  return (
    <li className="list__row">
      <div className="followee">
        {item.AvatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="avatar" src={item.AvatarUrl} alt={item.Fullname} />
        ) : (
          <span className="avatar" aria-hidden="true">
            {item.Fullname.charAt(0) || '知'}
          </span>
        )}
        <div className="followee__body">
          <a href={item.Url} target="_blank" rel="noreferrer">
            <p className="followee__name">{item.Fullname}</p>
          </a>
          <p className="followee__headline">
            {item.Headline || '这个人很懒，什么都没写'}
          </p>
        </div>
        <span className="content-item__meta">
          {item.FollowerCount.toLocaleString('zh-CN')} 关注者
        </span>
      </div>
    </li>
  );
}

/** 一个可复用的「加载更多」列表，负责分页状态与错误处理 */
function PagedList<T>({
  endpoint,
  renderRow,
  emptyText,
  keyOf,
}: {
  endpoint: string;
  renderRow: (item: T) => React.ReactNode;
  emptyText: string;
  keyOf: (item: T, index: number) => string;
}) {
  // items 与其来源 endpoint 绑定：即使实例被意外复用，也不会把上一个 Tab 的
  // 数据交给新的 renderRow 渲染，从根本上避免字段错配。
  const [state, setState] = useState<{ source: string; items: T[] }>({
    source: endpoint,
    items: [],
  });
  const items = state.source === endpoint ? state.items : [];
  const setItems = useCallback(
    (updater: (prev: T[]) => T[]) => {
      setState((prev) => ({
        source: endpoint,
        items: updater(prev.source === endpoint ? prev.items : []),
      }));
    },
    [endpoint],
  );

  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const load = useCallback(
    async (offset: number, append: boolean) => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(
          `${endpoint}?offset=${offset}&limit=${PAGE_SIZE}`,
          { credentials: 'same-origin' },
        );
        const body = await res.json();

        if (!res.ok) {
          throw new Error(
            res.status === 401
              ? '登录状态已失效，请重新登录后再试。'
              : (body?.error ?? '加载失败'),
          );
        }

        const page = body as PagedResult<T>;
        setItems((prev) => (append ? [...prev, ...page.items] : page.items));
        setNextOffset(page.isEnd ? null : page.nextOffset);
        setTotal(page.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        setLoading(false);
        setInitialized(true);
      }
    },
    [endpoint, setItems],
  );

  useEffect(() => {
    // 切换 Tab（endpoint 变化）时重置分页状态并加载首页
    setItems(() => []);
    setNextOffset(0);
    setTotal(null);
    setInitialized(false);
    void load(0, false);
  }, [load, setItems]);

  if (!initialized && loading) {
    return <div className="state">加载中…</div>;
  }

  return (
    <>
      {error && <div className="notice notice--error">{error}</div>}

      {items.length === 0 && initialized && !error ? (
        <div className="state">{emptyText}</div>
      ) : (
        <ul className="list">
          {items.map((item, index) => (
            // 用 Fragment 承载 key，避免在 <ul> 下插入非 <li> 节点
            <Fragment key={keyOf(item, index)}>{renderRow(item)}</Fragment>
          ))}
        </ul>
      )}

      <div className="load-more-wrap">
        {nextOffset !== null ? (
          <button
            type="button"
            className="load-more"
            disabled={loading}
            onClick={() => void load(nextOffset, true)}
          >
            {loading ? '加载中…' : '加载更多'}
          </button>
        ) : (
          items.length > 0 && (
            <span className="state">
              已加载全部
              {total !== null ? ` ${total} 条` : ''}
            </span>
          )
        )}
      </div>
    </>
  );
}

/** 用户页下半部分：关注的人 / 我的创作 两个 Tab */
export default function ProfileTabs() {
  const [tab, setTab] = useState<Tab>('followees');

  return (
    <div className="card">
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'followees'}
          className={`tab${tab === 'followees' ? ' tab--active' : ''}`}
          onClick={() => setTab('followees')}
        >
          关注的人
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'contents'}
          className={`tab${tab === 'contents' ? ' tab--active' : ''}`}
          onClick={() => setTab('contents')}
        >
          我的创作
        </button>
      </div>

      {/*
        两个分支的 PagedList 处于同一渲染位置，若不加 key，React 会复用同一个
        组件实例，导致上一个 Tab 的 items 状态被下一个 Tab 的 renderRow 消费，
        进而出现字段读取错误、整个组件崩溃卸载。用 key 强制重建实例。
      */}
      {tab === 'followees' ? (
        <PagedList<FolloweeItem>
          key="followees"
          endpoint="/api/me/followees"
          emptyText="还没有关注任何人"
          keyOf={(item, index) => `${item.UrlToken}-${index}`}
          renderRow={(item) => <FolloweeRow item={item} />}
        />
      ) : (
        <PagedList<ContentItem>
          key="contents"
          endpoint="/api/me/contents"
          emptyText="还没有发布过内容"
          keyOf={(item, index) => `${item.Url}-${index}`}
          renderRow={(item) => <ContentRow item={item} />}
        />
      )}
    </div>
  );
}
