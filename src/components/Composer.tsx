'use client';

import { useState } from 'react';

import { MatchCard } from '@/components/OpinionCard';
import type { MatchResult, Opinion, Visibility } from '@/lib/store';

/**
 * 观点发表器。
 *
 * 产品核心：把「可见性」与「连接意图」拆成两个独立决策，且都由用户显式选择。
 *
 *   1. 发表前选可见性：「仅自己可见」与「公开发表」互斥，点任一侧都能切换；
 *   2. 发表后选连接意图：公开发表成功后，再询问要不要立即找相似的人。
 *
 * 之所以把匹配挪到发表之后，是因为「写下来」和「想认识人」本就是两件事。
 * 用户可以先把想法放进广场，之后仍可能被别人匹配到，不必在下笔时就决定。
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

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okText, setOkText] = useState<string | null>(null);

  /** 刚发表成功的公开观点，用于发表后按需发起匹配 */
  const [justPublished, setJustPublished] = useState<Opinion | null>(null);
  const [matching, setMatching] = useState(false);

  const [matches, setMatches] = useState<MatchResult[] | null>(null);
  const [matchNote, setMatchNote] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set());

  const isPrivate = visibility === 'private';

  /** 两个选项互斥：点任意一侧都切换到对应可见性 */
  function choose(next: Visibility) {
    setVisibility(next);
  }

  function resetResult() {
    setOkText(null);
    setError(null);
    setJustPublished(null);
    setMatches(null);
    setMatchNote(null);
  }

  async function publish() {
    const text = content.trim();
    if (!text) {
      setError('观点内容不能为空。');
      return;
    }

    setBusy(true);
    resetResult();

    try {
      const res = await fetch('/api/opinions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          content: text,
          topic,
          visibility,
          // 匹配改为发表后由用户单独决定，发表请求本身不触发匹配
          match: false,
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

      const opinion = body.opinion as Opinion;
      setContent('');

      if (opinion.visibility === 'private') {
        setOkText('已保存为仅自己可见的记录，不会进入匹配池。');
      } else {
        // 公开内容已进入广场，此时再询问是否主动寻找相似的人
        setJustPublished(opinion);
        setOkText('已发表到广场，其他人可能匹配到你。');
      }

      onPublished?.(opinion);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发表失败');
    } finally {
      setBusy(false);
    }
  }

  /** 发表后按用户意愿发起匹配 */
  async function findMatches() {
    if (!justPublished) return;

    setMatching(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/opinions/${justPublished.id}/matches`,
        { credentials: 'same-origin' },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? '匹配失败');

      setMatches(body.matches ?? []);
      setMatchNote(body.note ?? null);
      setOkText(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '匹配失败');
    } finally {
      setMatching(false);
    }
  }

  /** 用户选择暂不匹配：内容留在广场，等待被动匹配 */
  function skipMatch() {
    setJustPublished(null);
    setOkText('已放入广场。之后其他人仍可能匹配到你的观点。');
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
          {/* 两个选项互斥，点任一侧都可切换 */}
          <label className="opt">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={() => choose('private')}
            />
            <span>
              仅自己可见
              <span className="opt__hint">作为记录贴，不进入匹配池</span>
            </span>
          </label>

          <label className="opt">
            <input
              type="checkbox"
              checked={!isPrivate}
              onChange={() => choose('public')}
            />
            <span>
              公开发表
              <span className="opt__hint">进入广场，可被他人匹配到</span>
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

      {/* 发表成功后再询问连接意图，把「写下来」和「想认识人」分成两步 */}
      {justPublished && matches === null && (
        <div className="post-publish">
          <p className="post-publish__title">现在就去找想法相似的人吗？</p>
          <p className="post-publish__sub">
            不找也没关系，你的观点已经在广场里，其他人依然可能匹配到你。
          </p>
          <div className="post-publish__actions">
            <button
              type="button"
              className="btn-primary"
              disabled={matching}
              onClick={() => void findMatches()}
            >
              {matching ? '正在寻找…' : '立即匹配'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={matching}
              onClick={skipMatch}
            >
              暂不匹配
            </button>
          </div>
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
              : (matchNote ??
                '你的观点已在广场中，之后仍可能被其他人匹配到。')}
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
