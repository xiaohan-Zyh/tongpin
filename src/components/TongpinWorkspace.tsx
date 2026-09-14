'use client';

import { useState } from 'react';

import Chat from '@/components/Chat';
import Composer from '@/components/Composer';
import MyOpinions from '@/components/MyOpinions';
import Requests from '@/components/Requests';
import Square from '@/components/Square';
import type { SessionUser } from '@/lib/types';

type Tab = 'record' | 'square' | 'requests' | 'chat';

/**
 * 「同频」主工作台。
 * 四个标签覆盖完整链路：发表记录 → 广场发现 → 交流请求 → 对话。
 */
export default function TongpinWorkspace({
  user,
  initialBadges,
  initialTopic = '',
}: {
  user: SessionUser;
  initialBadges: { incoming: number; threads: number };
  /** 从热榜「写下我的看法」带入的议题 */
  initialTopic?: string;
}) {
  const [tab, setTab] = useState<Tab>('record');
  // 发表或接受请求后，用递增 key 触发对应列表重新拉取
  const [opinionKey, setOpinionKey] = useState(0);
  const [threadKey, setThreadKey] = useState(0);
  const [requestedThreadId, setRequestedThreadId] = useState<string | null>(null);

  // 未读会话数：初始值来自服务端，之后由 Chat 组件实时更新
  const [unreadThreads, setUnreadThreads] = useState(initialBadges.threads);

  const tabs: Array<{ id: Tab; label: string; badge?: number }> = [
    { id: 'record', label: '我的记录' },
    { id: 'square', label: '广场' },
    { id: 'requests', label: '交流请求', badge: initialBadges.incoming },
    { id: 'chat', label: '对话', badge: unreadThreads },
  ];

  return (
    <>
      <h1 className="page-title">同频</h1>
      <p className="page-subtitle">
        写下你的观点，找到想法相似的人。对方同意后才会开始对话。
      </p>

      {/* 发表器常驻在所有标签之上：无论在看广场、请求还是对话，
          都能随时写下当下的想法，不必先切回「我的记录」 */}
      <Composer
        defaultTopic={initialTopic}
        onPublished={() => setOpinionKey((k) => k + 1)}
      />

      <div className="card" style={{ marginTop: 20 }}>
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`tab${tab === t.id ? ' tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.badge ? <span className="badge-dot">{t.badge}</span> : null}
            </button>
          ))}
        </div>

        {/* key 确保切换标签时组件实例重建，避免不同数据源的状态串用 */}
        {tab === 'record' && (
          <MyOpinions key="record" reloadKey={opinionKey} />
        )}
        {tab === 'square' && <Square key="square" reloadKey={opinionKey} />}
        {tab === 'requests' && (
          <Requests
            key="requests"
            onAccepted={() => setThreadKey((k) => k + 1)}
            onOpenThread={(threadId) => {
              setRequestedThreadId(threadId);
              setTab('chat');
            }}
          />
        )}
        {tab === 'chat' && (
          <Chat
            key="chat"
            currentUserId={user.id}
            reloadKey={threadKey}
            requestedThreadId={requestedThreadId}
            onUnreadChange={setUnreadThreads}
          />
        )}
      </div>
    </>
  );
}
