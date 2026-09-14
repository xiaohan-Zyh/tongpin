'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { timeAgo } from '@/components/OpinionCard';
import type { Message, ThreadSummary } from '@/lib/store';

/** 对话：左侧会话列表，右侧消息区 */
export default function Chat({
  currentUserId,
  reloadKey,
  onUnreadChange,
}: {
  currentUserId: string;
  reloadKey: number;
  /** 未读会话数变化时通知上层，用于同步顶部标签角标 */
  onUnreadChange?: (unreadThreads: number) => void;
}) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [peerName, setPeerName] = useState('');
  const [origin, setOrigin] = useState('');

  const [loadingList, setLoadingList] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const bodyRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const res = await fetch('/api/threads', { credentials: 'same-origin' });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(
          res.status === 401 ? '登录状态已失效，请重新登录。' : body?.error ?? '加载失败',
        );
      }
      const list: ThreadSummary[] = body.items ?? [];
      setThreads(list);
      onUnreadChange?.(list.filter((t) => t.unreadCount > 0).length);
      // 默认选中第一个会话，避免右侧空白
      setActiveId((prev) => prev ?? list[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoadingList(false);
    }
  }, [onUnreadChange]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads, reloadKey]);

  const loadMessages = useCallback(
    async (threadId: string) => {
      setLoadingChat(true);
      setError(null);
      try {
        const res = await fetch(`/api/threads/${threadId}`, {
          credentials: 'same-origin',
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? '加载对话失败');

        setMessages(body.messages ?? []);
        setPeerName(body.peerName ?? '');
        setOrigin(body.originExcerpt ?? '');

        // 服务端在返回消息时已把该会话标记为已读，
        // 这里同步清掉本地红点，无需等待下一次列表刷新
        setThreads((prev) => {
          const next = prev.map((t) =>
            t.id === threadId ? { ...t, unreadCount: 0 } : t,
          );
          onUnreadChange?.(next.filter((t) => t.unreadCount > 0).length);
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载对话失败');
      } finally {
        setLoadingChat(false);
      }
    },
    [onUnreadChange],
  );

  useEffect(() => {
    if (activeId) void loadMessages(activeId);
  }, [activeId, loadMessages]);

  // 新消息后滚动到底部
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    const text = draft.trim();
    if (!text || !activeId) return;

    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/threads/${activeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ content: text }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? '发送失败');

      setMessages((prev) => [...prev, body.message as Message]);
      setDraft('');
      void loadThreads();
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSending(false);
    }
  }

  if (loadingList && threads.length === 0) {
    return <div className="state">加载中…</div>;
  }

  if (threads.length === 0) {
    return (
      <div className="state">
        还没有对话。在广场或匹配结果中发起交流，对方同意后就会出现在这里。
      </div>
    );
  }

  return (
    <>
      {error && <div className="notice notice--error">{error}</div>}

      <div className="chat-layout">
        <aside className="chat-layout__side">
          {threads.map((t) => (
            <button
              type="button"
              key={t.id}
              className={`thread-item${t.id === activeId ? ' thread-item--active' : ''}`}
              onClick={() => setActiveId(t.id)}
            >
              <div className="thread-item__row">
                <p className="thread-item__name">{t.peerName}</p>
                {t.unreadCount > 0 && (
                  <span className="unread-dot" aria-label={`${t.unreadCount} 条未读消息`}>
                    {t.unreadCount > 99 ? '99+' : t.unreadCount}
                  </span>
                )}
              </div>
              <p className="thread-item__last">
                {t.lastMessage || '（还没有消息）'}
              </p>
            </button>
          ))}
        </aside>

        <div className="chat">
          <header className="chat__head">
            <p className="chat__peer">{peerName}</p>
            {origin && <p className="chat__origin">因这条观点相遇：{origin}…</p>}
          </header>

          <div className="chat__body" ref={bodyRef}>
            {loadingChat ? (
              <div className="state">加载中…</div>
            ) : (
              messages.map((m) => {
                const mine = m.senderId === currentUserId;
                return (
                  <div
                    key={m.id}
                    className={`bubble-row${mine ? ' bubble-row--mine' : ''}`}
                  >
                    <div className={`bubble${mine ? ' bubble--mine' : ''}`}>
                      {m.content}
                      <div className="bubble__meta">{timeAgo(m.createdAt)}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="chat__form">
            <input
              className="chat__input"
              placeholder="说点什么…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              maxLength={1000}
            />
            <button
              type="button"
              className="btn-primary"
              disabled={sending || draft.trim().length === 0}
              onClick={() => void send()}
            >
              {sending ? '发送中…' : '发送'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
