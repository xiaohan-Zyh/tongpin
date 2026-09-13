'use client';

import { useState } from 'react';

import { MatchCard } from '@/components/OpinionCard';
import type { MatchResult, Opinion, Visibility } from '@/lib/store';

/**
 * 观点发表器。
 *
 * 产品核心：把「可见性」与「是否立即匹配」呈现为两个独立选择，
 * 并在选择「仅自己可见」时明确禁用匹配——因为私密内容永不进入匹配池。
 */
export default function Composer({
  defaultTopic = '',
  onPublished,
}: {
  defaultTopic?: string;
  onPublished?: (opinion: Opinion) => void;
}) {
  const [content, setContent] = useState('');
  const [topic, setTopic] = useState(defaultTopic);
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [wantMatch, setWantMatch] = useState(true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okText, setOkText] = useState<string | null>(null);

  const [matches, setMatches] = useState<MatchResult[] | null>(null);
  const [matchNote, setMatchNote] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set());

  const isPrivate = visibility === 'private';
  // 私密内容不参与匹配，界面上同步禁用该选项，避免给出无法实现的承诺
  const matchEnabled = wantMatch && !isPrivate;

  async function publish() {
    const text = content.trim();
    if (!text) {
      setError('观点内容不能为空。');
      return;
    }

    setBusy(true);
    setError(null);
    setOkText(null);
    setMatches(null);
    setMatchNote(null);

    try {
      const res = await fetch('/api/opinions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          content: text,
          topic,
          visibility,
          match: matchEnabled,
        }),
      });
      const body = await res.json();

      if (!res.ok) {
        throw new Error(
          res.status === 401
            ? '登录状态已失效，请重新登录后再试。'
            : (body?.error ?? '发表失败'),
        );
      }

      setContent('');
      setOkText(
        isPrivate
          ? '已保存为仅自己可见的记录。'
          : matchEnabled
            ? '已发表。'
            : '已发表。之后其他人仍可能匹配到你的观点。',
      );

      if (body.matched) {
        setMatches(body.matches ?? []);
        setMatchNote(body.note ?? null);
      }

      onPublished?.(body.opinion as Opinion);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发表失败');
    } finally {
      setBusy(false);
    }
  }

  async function connect(match: MatchResult) {
    setConnectingId(match.opinion.id);
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
      setOkText('交流请求已发送，等对方同意后就能开始对话。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '发起交流失败');
    } finally {
      setConnectingId(null);
    }
  }

  return (
    <section className="card composer">
      <textarea
        className="composer__textarea"
        placeholder="写下你的观点或此刻的感受…"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={1000}
      />

      <input
        className="composer__topic"
        placeholder="话题（可留空，如：考研、毕业去向）"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        maxLength={30}
      />

      <div className="composer__row">
        <div className="composer__options">
          <label className="opt">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) =>
                setVisibility(e.target.checked ? 'private' : 'public')
              }
            />
            <span>
              仅自己可见
              <span className="opt__hint">
                作为记录贴，不进入匹配池
              </span>
            </span>
          </label>

          <label className="opt" style={{ opacity: isPrivate ? 0.45 : 1 }}>
            <input
              type="checkbox"
              checked={matchEnabled}
              disabled={isPrivate}
              onChange={(e) => setWantMatch(e.target.checked)}
            />
            <span>
              发表后立即匹配
              <span className="opt__hint">
                {isPrivate
                  ? '私密内容不参与匹配'
                  : '不勾选也会被其他人匹配到'}
              </span>
            </span>
          </label>
        </div>

        <button
          type="button"
          className="btn-primary"
          disabled={busy || content.trim().length === 0}
          onClick={publish}
        >
          {busy ? '发表中…' : '发表'}
        </button>
      </div>

      {error && (
        <div className="notice notice--error" style={{ marginTop: 14 }}>
          {error}
        </div>
      )}
      {okText && !error && (
        <div className="notice notice--ok" style={{ marginTop: 14 }}>
          {okText}
        </div>
      )}

      {matches !== null && (
        <div className="match-panel">
          <h3 className="match-panel__title">
            {matches.length > 0
              ? `找到 ${matches.length} 位可能同频的人`
              : '暂时没有找到相近的观点'}
          </h3>
          <p className="match-panel__sub">
            {matches.length > 0
              ? '先看看对方写了什么。发起交流后，对方同意才会开始对话。'
              : matchNote}
          </p>

          {matches.map((m) => (
            <MatchCard
              key={m.opinion.id}
              match={m}
              busy={connectingId === m.opinion.id}
              done={connectedIds.has(m.opinion.id)}
              onConnect={() => void connect(m)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
