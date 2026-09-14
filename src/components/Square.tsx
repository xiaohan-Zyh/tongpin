'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  DEFAULT_GREETING,
  GreetingEditor,
  OpinionCard,
} from '@/components/OpinionCard';
import type { Opinion } from '@/lib/store';

const PAGE = 10;

/**
 * 公开广场：浏览他人公开的观点，可直接发起交流。
 * 仅自己可见的内容不会出现在这里。
 *
 * reloadKey 变化时重新拉取，使用户在本页发表观点后能立即看到广场更新。
 */
export default function Square({ reloadKey = 0 }: { reloadKey?: number }) {
  const [items, setItems] = useState<Opinion[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okText, setOkText] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

  const load = useCallback(async (offset: number, append: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/opinions?scope=square&offset=${offset}&limit=${PAGE}`,
        { credentials: 'same-origin' },
      );
      const body = await res.json();
      if (!res.ok) {
        throw new Error(
          res.status === 401 ? '登录状态已失效，请重新登录。' : body?.error ?? '加载失败',
        );
      }
      setItems((prev) => (append ? [...prev, ...body.items] : body.items));
      setNextOffset(body.isEnd ? null : body.nextOffset);
      setTotal(body.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void load(0, false);
  }, [load, reloadKey]);

  async function connect(opinion: Opinion, greeting = DEFAULT_GREETING) {
    setBusyId(opinion.id);
    setError(null);
    setOkText(null);
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          opinionId: opinion.id,
          greeting,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? '发起交流失败');

      setSentIds((prev) => new Set(prev).add(opinion.id));
      setOkText('交流请求已发送，等对方同意后就能开始对话。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '发起交流失败');
    } finally {
      setBusyId(null);
    }
  }

  if (!ready && loading) return <div className="state">加载中…</div>;

  return (
    <>
      {error && <div className="notice notice--error">{error}</div>}
      {okText && !error && <div className="notice notice--ok">{okText}</div>}

      {items.length === 0 && ready ? (
        <div className="state">广场还没有公开的观点。</div>
      ) : (
        items.map((o) => (
          <OpinionCard
            key={o.id}
            opinion={o}
            footer={
              sentIds.has(o.id) ? (
                <button type="button" className="btn-ghost" disabled>
                  已发起交流
                </button>
              ) : (
                <GreetingEditor
                  busy={busyId === o.id}
                  onSubmit={(greeting) => void connect(o, greeting)}
                />
              )
            }
          />
        ))
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
          items.length > 0 && <span className="state">已加载全部 {total} 条</span>
        )}
      </div>
    </>
  );
}
