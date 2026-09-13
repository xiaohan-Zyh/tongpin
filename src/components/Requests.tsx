'use client';

import { useCallback, useEffect, useState } from 'react';

import { Dot, timeAgo } from '@/components/OpinionCard';
import type { ContactRequest } from '@/lib/store';

/**
 * 交流请求。
 * 产品关键：对方同意前不会开启对话，这里是「同意」这一步的落点。
 */
export default function Requests({
  onAccepted,
}: {
  onAccepted?: () => void;
}) {
  const [box, setBox] = useState<'incoming' | 'outgoing'>('incoming');
  const [items, setItems] = useState<ContactRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okText, setOkText] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests?box=${box}`, {
        credentials: 'same-origin',
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(
          res.status === 401 ? '登录状态已失效，请重新登录。' : body?.error ?? '加载失败',
        );
      }
      setItems(body.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
      setReady(true);
    }
  }, [box]);

  useEffect(() => {
    setItems([]);
    setReady(false);
    void load();
  }, [load]);

  async function respond(req: ContactRequest, accept: boolean) {
    setBusyId(req.id);
    setError(null);
    setOkText(null);
    try {
      const res = await fetch(`/api/requests/${req.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ accept }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? '处理失败');

      setItems((prev) => prev.filter((r) => r.id !== req.id));
      setOkText(accept ? '已同意，可以在「对话」中开始聊天了。' : '已拒绝该请求。');
      if (accept) onAccepted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '处理失败');
    } finally {
      setBusyId(null);
    }
  }

  const statusText: Record<string, string> = {
    pending: '等待对方回应',
    accepted: '已同意',
    declined: '已拒绝',
  };

  return (
    <>
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={box === 'incoming'}
          className={`tab${box === 'incoming' ? ' tab--active' : ''}`}
          onClick={() => setBox('incoming')}
        >
          收到的请求
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={box === 'outgoing'}
          className={`tab${box === 'outgoing' ? ' tab--active' : ''}`}
          onClick={() => setBox('outgoing')}
        >
          我发出的
        </button>
      </div>

      {error && <div className="notice notice--error">{error}</div>}
      {okText && !error && <div className="notice notice--ok">{okText}</div>}

      {!ready && loading ? (
        <div className="state">加载中…</div>
      ) : items.length === 0 ? (
        <div className="state">
          {box === 'incoming'
            ? '目前没有待处理的交流请求。'
            : '还没有发出过交流请求。'}
        </div>
      ) : (
        items.map((r) => (
          <div className="req" key={r.id}>
            <div className="opinion__head">
              <Dot name={box === 'incoming' ? r.fromName : r.toName} />
              <span className="opinion__author">
                {box === 'incoming' ? r.fromName : r.toName}
              </span>
              <span className="opinion__time">{timeAgo(r.createdAt)}</span>
              {box === 'outgoing' && (
                <span className="chip chip--score">{statusText[r.status]}</span>
              )}
            </div>

            <div className="req__quote">因这条观点：{r.opinionExcerpt}…</div>
            {r.greeting && <p className="req__greeting">{r.greeting}</p>}

            {box === 'incoming' && (
              <div className="req__actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busyId === r.id}
                  onClick={() => void respond(r, true)}
                >
                  {busyId === r.id ? '处理中…' : '同意并开始对话'}
                </button>
                <button
                  type="button"
                  className="btn-danger-ghost"
                  disabled={busyId === r.id}
                  onClick={() => void respond(r, false)}
                >
                  拒绝
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </>
  );
}
