'use client';

import type { MatchResult, Opinion } from '@/lib/store';

/** 相对时间显示 */
export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

/** 头像占位块 */
export function Dot({ name }: { name: string }) {
  return (
    <span className="avatar" aria-hidden="true">
      {name.trim().charAt(0) || '知'}
    </span>
  );
}

/**
 * 观点卡片。
 * showVisibility 仅在「我的记录」中开启，广场不暴露他人的可见性控制。
 */
export function OpinionCard({
  opinion,
  showVisibility = false,
  onToggle,
  busy = false,
  footer,
}: {
  opinion: Opinion;
  showVisibility?: boolean;
  onToggle?: (next: 'public' | 'private') => void;
  busy?: boolean;
  footer?: React.ReactNode;
}) {
  const isPublic = opinion.visibility === 'public';

  return (
    <article className="opinion">
      <header className="opinion__head">
        <Dot name={opinion.authorName} />
        <span className="opinion__author">{opinion.authorName}</span>
        {opinion.topic && <span className="chip">{opinion.topic}</span>}
        <span className="opinion__time">{timeAgo(opinion.createdAt)}</span>
      </header>

      <p className="opinion__body">{opinion.content}</p>

      <div className="opinion__foot">
        {showVisibility && (
          <>
            <span className={`chip ${isPublic ? 'chip--public' : 'chip--private'}`}>
              {isPublic ? '公开 · 可被匹配' : '仅自己可见'}
            </span>
            {onToggle && (
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={() => onToggle(isPublic ? 'private' : 'public')}
              >
                {busy ? '切换中…' : isPublic ? '设为仅自己可见' : '设为公开'}
              </button>
            )}
          </>
        )}
        {footer}
      </div>
    </article>
  );
}

/** 匹配结果卡片，展示相似度与命中理由 */
export function MatchCard({
  match,
  onConnect,
  busy = false,
  done = false,
}: {
  match: MatchResult;
  onConnect?: () => void;
  busy?: boolean;
  done?: boolean;
}) {
  return (
    <div className="match-card">
      <header className="opinion__head">
        <Dot name={match.opinion.authorName} />
        <span className="opinion__author">{match.opinion.authorName}</span>
        {match.opinion.topic && (
          <span className="chip">{match.opinion.topic}</span>
        )}
        <span className="chip chip--score">
          相似度 {Math.round(match.score * 100)}%
        </span>
      </header>

      <p className="opinion__body">{match.opinion.content}</p>

      {match.reasons.length > 0 && (
        <div className="match-card__reasons">
          <span className="match-card__label">共同点：</span>
          {match.reasons.map((r) => (
            <span key={r} className="chip chip--reason">
              {r}
            </span>
          ))}
        </div>
      )}

      {onConnect && (
        <button
          type="button"
          className="btn-ghost"
          disabled={busy || done}
          onClick={onConnect}
        >
          {done ? '已发起交流' : busy ? '发送中…' : '发起交流'}
        </button>
      )}
    </div>
  );
}
