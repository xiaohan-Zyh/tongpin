'use client';

import { useCallback, useEffect, useState } from 'react';

import { MatchCard, OpinionCard } from '@/components/OpinionCard';
import type { MatchResult, Opinion, Visibility } from '@/lib/store';

const PAGE = 10;

/**
 * 我的记录：展示本人全部观点（含仅自己可见），
 * 支持随时切换可见性，以及为公开观点补做匹配。
 */
export default function MyOpinions({ reloadKey }: { reloadKey: number }) {
  const [items, setItems] = useState<Opinion[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [togglingId, setTogglingId] = useState<string | null>(null);

  // 展开中的匹配结果：观点 id -> 结果
  const [matchOf, setMatchOf] = useState<Record<string, MatchResult[]>>({});
  const [matchNote, setMatchNote] = useState<Record<string, string>>({});
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async (offset: number, append: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/opinions?scope=mine&offset=${offset}&limit=${PAGE}`, {
        credentials: 'same-origin',
      });
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

  async function toggle(opinion: Opinion, next: Visibility) {
    setTogglingId(opinion.id);
    setError(null);
    try {
      const res = await fetch(`/api/opinions/${opinion.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ visibility: next }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? '切换失败');

      setItems((prev) =>
        prev.map((o) => (o.id === opinion.id ? (body.opinion as Opinion) : o)),
      );
      // 转为私密后，已展示的匹配结果不再适用，一并清理
      if (next === 'private') {
        setMatchOf((prev) => {
          const copy = { ...prev };
          delete copy[opinion.id];
          return copy;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换失败');
    } finally {
      setTogglingId(null);
    }
  }

  async function findMatch(opinion: Opinion) {
    setMatchingId(opinion.id);
    setError(null);
    try {
      const res = await fetch(`/api/opinions/${opinion.id}/matches`, {
        credentials: 'same-origin',
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? '匹配失败');

      setMatchOf((prev) => ({ ...prev, [opinion.id]: body.matches ?? [] }));
      setMatchNote((prev) => ({ ...prev, [opinion.id]: body.note ?? '' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '匹配失败');
    } finally {
      setMatchingId(null);
    }
  }

  async function connect(match: MatchResult) {
    setError(null);
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          opinionId: match.opinion.id,
          greeting: '你好，看到你的观点很有同感，想和你聊聊。',
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? '发起交流失败');
      setConnectedIds((prev) => new Set(prev).add(match.opinion.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '发起交流失败');
    }
  }

  if (!ready && loading) return <div className="state">加载中…</div>;

  return (
    <>
      {error && <div className="notice notice--error">{error}</div>}

      {items.length === 0 && ready ? (
        <div className="state">还没有记录，在上方写下第一条吧。</div>
      ) : (
        items.map((o) => (
          <div key={o.id}>
            <OpinionCard
              opinion={o}
              showVisibility
              busy={togglingId === o.id}
              onToggle={(next) => void toggle(o, next)}
              footer={
                o.visibility === 'public' ? (
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={matchingId === o.id}
                    onClick={() => void findMatch(o)}
                  >
                    {matchingId === o.id ? '匹配中…' : '找相似观点'}
                  </button>
                ) : null
              }
            />

            {matchOf[o.id] && (
              <div style={{ padding: '0 20px 18px' }}>
                <div className="match-panel">
                  <h3 className="match-panel__title">
                    {matchOf[o.id].length > 0
                      ? `找到 ${matchOf[o.id].length} 位可能同频的人`
                      : '暂时没有找到相近的观点'}
                  </h3>
                  <p className="match-panel__sub">
                    {matchOf[o.id].length > 0
                      ? '发起交流后，对方同意才会开始对话。'
                      : matchNote[o.id]}
                  </p>
                  {matchOf[o.id].map((m) => (
                    <MatchCard
                      key={m.opinion.id}
                      match={m}
                      done={connectedIds.has(m.opinion.id)}
                      onConnect={() => void connect(m)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
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
          items.length > 0 && (
            <span className="state">已加载全部 {total} 条</span>
          )
        )}
      </div>
    </>
  );
}
