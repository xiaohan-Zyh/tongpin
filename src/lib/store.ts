import 'server-only';

/**
 * 「同频」领域模型与内存数据仓库。
 *
 * 存储选型说明：
 * 黑客松 Demo 采用进程内存 + 预置种子数据。评委点开即可看到真实的匹配
 * 效果，无需先注册多个账号互相发帖。所有读写都集中在本文件，函数签名
 * 即为将来替换 Postgres/Redis 时的接口边界。
 *
 * 已知边界（产品说明中如实标注）：进程重启后新增数据丢失；多实例部署
 * 时各实例数据不共享。
 */

import { randomUUID } from 'node:crypto';

import { buildIdf, similarity, tokenize } from '@/lib/similarity';
import type { SessionUser } from '@/lib/types';

/* =========================================================================
 * 领域模型
 * ====================================================================== */

/**
 * 观点可见性。与「是否发起匹配」完全正交：
 * 可见性决定内容是否进入匹配池，匹配动作只决定这一次要不要主动去找人。
 */
export type Visibility = 'public' | 'private';

export interface Opinion {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  content: string;
  /** 话题标签，可留空 */
  topic: string;
  visibility: Visibility;
  createdAt: number;
  updatedAt: number;
}

/** 匹配结果：观点 + 相似度 + 命中理由 */
export interface MatchResult {
  opinion: Opinion;
  /** 0~1 */
  score: number;
  /** 命中的关键词，用于向用户解释「为什么匹配」 */
  reasons: string[];
}

export type RequestStatus = 'pending' | 'accepted' | 'declined';

/** 交流请求：匹配到观点后，必须经对方同意才能对话 */
export interface ContactRequest {
  id: string;
  fromId: string;
  fromName: string;
  fromAvatar: string;
  toId: string;
  toName: string;
  /** 触发本次请求的观点 */
  opinionId: string;
  opinionExcerpt: string;
  /** 打招呼的话 */
  greeting: string;
  status: RequestStatus;
  createdAt: number;
  respondedAt: number | null;
}

export interface Message {
  id: string;
  threadId: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: number;
}

/** 对话线程。请求被接受后创建，与请求解耦，便于将来支持多来源建联 */
export interface Thread {
  id: string;
  /** 参与者，固定两人 */
  memberIds: [string, string];
  memberNames: [string, string];
  /** 建立这段关系的观点摘要，作为对话的共同背景 */
  originExcerpt: string;
  createdAt: number;
}

/** 对话列表展示项 */
export interface ThreadSummary {
  id: string;
  peerName: string;
  originExcerpt: string;
  lastMessage: string;
  lastMessageAt: number;
  messageCount: number;
}

/* =========================================================================
 * 存储
 * ====================================================================== */

const opinions = new Map<string, Opinion>();
const requests = new Map<string, ContactRequest>();
const threads = new Map<string, Thread>();
const messages = new Map<string, Message[]>();

/** 相似度门槛：低于此值视为不相关，宁可不给结果也不用低质量内容凑数 */
export const MATCH_THRESHOLD = 0.05;

/* =========================================================================
 * 种子数据
 * ====================================================================== */

const SEEDS: Array<{
  id: string;
  name: string;
  topic: string;
  content: string;
  daysAgo: number;
}> = [
  {
    id: 'u_lin', name: '林间有风', topic: '考研',
    content:
      '考研二战真的很煎熬。每天六点半到图书馆，晚上十点才走，可越复习越觉得心里没底。最难的不是知识点，是那种「万一又没考上」的恐惧一直悬在头顶。',
    daysAgo: 1,
  },
  {
    id: 'u_latte', name: '午后拿铁', topic: '考研',
    content:
      '我也在二战，图书馆一坐就是一整天，焦虑到晚上睡不着。有时候会想这一年的时间成本到底值不值，但既然开始了就不想半途而废。',
    daysAgo: 2,
  },
  {
    id: 'u_south', name: '城南旧事', topic: '毕业去向',
    content:
      '毕业后到底回老家还是留在大城市，纠结了大半年。留下来房租吃掉一半工资，回去又怕再没有这样的机会，两条路都要放弃一些东西。',
    daysAgo: 3,
  },
  {
    id: 'u_north', name: '北纬四十度', topic: '毕业去向',
    content:
      '留在大城市房租太高，通勤一个半小时；回老家又怕没机会。最近很纠结，感觉被困在选择里，怎么选都像在放弃另一种人生。',
    daysAgo: 4,
  },
  {
    id: 'u_noice', name: '不加冰', topic: '社交',
    content:
      '越来越不想参加饭局了。一桌人聊的都是不痛不痒的话题，散场后反而更空。我好像更喜欢能安静聊一会儿真心话的那种关系。',
    daysAgo: 2,
  },
  {
    id: 'u_bakery', name: '深夜面包店', topic: '社交',
    content:
      '我也很怕热闹的场合，人多但没有一句话是真的。宁愿一个人待着，或者和一两个能说真话的朋友慢慢聊。安静不等于孤独。',
    daysAgo: 5,
  },
  {
    id: 'u_sunny', name: '晴天见', topic: '生活记录',
    content:
      '今天下楼买菜，发现巷口的桂花开了。突然想起小时候外婆院子里也有一棵，有些味道能一下把人带回很多年前。',
    daysAgo: 1,
  },
  {
    id: 'u_slow', name: '慢半拍', topic: '职场',
    content:
      '工作三年，最大的变化是不再急着证明自己。以前觉得加班是努力，现在觉得能把事做对、按时下班才是真本事。',
    daysAgo: 6,
  },
];

let seeded = false;

function ensureSeeded(): void {
  if (seeded) return;
  seeded = true;

  const now = Date.now();
  for (const s of SEEDS) {
    const at = now - s.daysAgo * 86_400_000;
    const id = `seed_${s.id}`;
    opinions.set(id, {
      id,
      authorId: s.id,
      authorName: s.name,
      authorAvatar: '',
      content: s.content,
      topic: s.topic,
      visibility: 'public',
      createdAt: at,
      updatedAt: at,
    });
  }
}

/* =========================================================================
 * 观点
 * ====================================================================== */

export function createOpinion(input: {
  author: SessionUser;
  content: string;
  topic: string;
  visibility: Visibility;
}): Opinion {
  ensureSeeded();

  const now = Date.now();
  const opinion: Opinion = {
    id: randomUUID(),
    authorId: input.author.id,
    authorName: input.author.name,
    authorAvatar: input.author.avatarUrl,
    content: input.content.trim(),
    topic: input.topic.trim(),
    visibility: input.visibility,
    createdAt: now,
    updatedAt: now,
  };

  opinions.set(opinion.id, opinion);
  return opinion;
}

export function getOpinion(id: string): Opinion | null {
  ensureSeeded();
  return opinions.get(id) ?? null;
}

/** 我的全部观点（含仅自己可见），按时间倒序 */
export function listMyOpinions(userId: string, offset = 0, limit = 10) {
  ensureSeeded();
  const all = [...opinions.values()]
    .filter((o) => o.authorId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
  return { items: all.slice(offset, offset + limit), total: all.length };
}

/** 公开广场，排除自己的内容 */
export function listSquare(viewerId: string, offset = 0, limit = 10) {
  ensureSeeded();
  const all = [...opinions.values()]
    .filter((o) => o.visibility === 'public' && o.authorId !== viewerId)
    .sort((a, b) => b.createdAt - a.createdAt);
  return { items: all.slice(offset, offset + limit), total: all.length };
}

/** 切换可见性；仅作者本人可操作 */
export function updateVisibility(
  opinionId: string,
  userId: string,
  visibility: Visibility,
): Opinion | null {
  ensureSeeded();
  const o = opinions.get(opinionId);
  if (!o || o.authorId !== userId) return null;

  o.visibility = visibility;
  o.updatedAt = Date.now();
  return o;
}

/* =========================================================================
 * 匹配
 * ====================================================================== */

/**
 * 为一条观点寻找相似的公开观点。
 *
 * 三条硬规则：
 *   1. 仅自己可见的内容永不进入匹配池（无论是作为源还是候选）；
 *   2. 排除自己的观点，避免自我匹配；
 *   3. 低于门槛的结果直接丢弃。
 */
export function findMatches(
  sourceId: string,
  viewerId: string,
  limit = 5,
): MatchResult[] {
  ensureSeeded();

  const source = opinions.get(sourceId);
  if (!source || source.visibility !== 'public') return [];

  const candidates = [...opinions.values()].filter(
    (o) =>
      o.visibility === 'public' && o.id !== sourceId && o.authorId !== viewerId,
  );
  if (candidates.length === 0) return [];

  const sourceTokens = tokenize(`${source.topic} ${source.content}`);
  const candidateTokens = candidates.map((o) =>
    tokenize(`${o.topic} ${o.content}`),
  );

  // IDF 在「源 + 全部候选」同一语料下统计，保证权重可比
  const idf = buildIdf([sourceTokens, ...candidateTokens]);

  return candidates
    .map((opinion, i) => {
      const { score, reasons } = similarity(
        sourceTokens,
        candidateTokens[i],
        idf,
      );
      return { opinion, score, reasons };
    })
    .filter((m) => m.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/* =========================================================================
 * 交流请求
 * ====================================================================== */

/** 查找两人之间针对同一观点的未拒绝请求，避免重复打扰 */
function findLiveRequest(a: string, b: string, opinionId: string) {
  return [...requests.values()].find(
    (r) =>
      r.opinionId === opinionId &&
      r.status !== 'declined' &&
      ((r.fromId === a && r.toId === b) || (r.fromId === b && r.toId === a)),
  );
}

export function createRequest(input: {
  from: SessionUser;
  opinionId: string;
  greeting: string;
}): { ok: true; request: ContactRequest } | { ok: false; reason: string } {
  ensureSeeded();

  const opinion = opinions.get(input.opinionId);
  if (!opinion) return { ok: false, reason: '该观点不存在或已被删除。' };
  if (opinion.visibility !== 'public') {
    return { ok: false, reason: '该观点未公开，无法发起交流。' };
  }
  if (opinion.authorId === input.from.id) {
    return { ok: false, reason: '不能向自己发起交流。' };
  }

  const live = findLiveRequest(input.from.id, opinion.authorId, opinion.id);
  if (live) {
    return {
      ok: false,
      reason:
        live.status === 'accepted'
          ? '你们已经建立对话，可以直接在「对话」中继续。'
          : '已经发起过交流请求，请等待对方回应。',
    };
  }

  const request: ContactRequest = {
    id: randomUUID(),
    fromId: input.from.id,
    fromName: input.from.name,
    fromAvatar: input.from.avatarUrl,
    toId: opinion.authorId,
    toName: opinion.authorName,
    opinionId: opinion.id,
    opinionExcerpt: opinion.content.slice(0, 60),
    greeting: input.greeting.trim(),
    status: 'pending',
    createdAt: Date.now(),
    respondedAt: null,
  };

  requests.set(request.id, request);
  return { ok: true, request };
}

/** 我收到的待处理请求 */
export function listIncoming(userId: string): ContactRequest[] {
  ensureSeeded();
  return [...requests.values()]
    .filter((r) => r.toId === userId && r.status === 'pending')
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** 我发出的请求 */
export function listOutgoing(userId: string): ContactRequest[] {
  ensureSeeded();
  return [...requests.values()]
    .filter((r) => r.fromId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 响应交流请求。接受后创建对话线程，并把打招呼的话作为第一条消息。
 * 仅接收方本人可处理，且只能处理一次。
 */
export function respondRequest(input: {
  requestId: string;
  userId: string;
  accept: boolean;
}):
  | { ok: true; request: ContactRequest; threadId: string | null }
  | { ok: false; reason: string } {
  ensureSeeded();

  const request = requests.get(input.requestId);
  if (!request) return { ok: false, reason: '该请求不存在。' };
  if (request.toId !== input.userId) {
    return { ok: false, reason: '只有被邀请方可以处理该请求。' };
  }
  if (request.status !== 'pending') {
    return { ok: false, reason: '该请求已经处理过了。' };
  }

  request.status = input.accept ? 'accepted' : 'declined';
  request.respondedAt = Date.now();

  if (!input.accept) return { ok: true, request, threadId: null };

  const thread: Thread = {
    id: randomUUID(),
    memberIds: [request.fromId, request.toId],
    memberNames: [request.fromName, request.toName],
    originExcerpt: request.opinionExcerpt,
    createdAt: Date.now(),
  };
  threads.set(thread.id, thread);

  messages.set(thread.id, [
    {
      id: randomUUID(),
      threadId: thread.id,
      senderId: request.fromId,
      senderName: request.fromName,
      content: request.greeting || '你好，很高兴遇到想法相似的人。',
      createdAt: request.createdAt,
    },
  ]);

  return { ok: true, request, threadId: thread.id };
}

/* =========================================================================
 * 对话
 * ====================================================================== */

/** 仅线程成员可访问 */
function getMemberThread(threadId: string, userId: string): Thread | null {
  const t = threads.get(threadId);
  if (!t || !t.memberIds.includes(userId)) return null;
  return t;
}

export function listThreads(userId: string): ThreadSummary[] {
  ensureSeeded();

  return [...threads.values()]
    .filter((t) => t.memberIds.includes(userId))
    .map((t) => {
      const thread = messages.get(t.id) ?? [];
      const last = thread[thread.length - 1];
      const peerIndex = t.memberIds[0] === userId ? 1 : 0;

      return {
        id: t.id,
        peerName: t.memberNames[peerIndex],
        originExcerpt: t.originExcerpt,
        lastMessage: last?.content ?? '',
        lastMessageAt: last?.createdAt ?? t.createdAt,
        messageCount: thread.length,
      };
    })
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

/** 读取消息；无权访问返回 null */
export function listMessages(
  threadId: string,
  userId: string,
): { messages: Message[]; peerName: string; originExcerpt: string } | null {
  ensureSeeded();

  const t = getMemberThread(threadId, userId);
  if (!t) return null;

  const peerIndex = t.memberIds[0] === userId ? 1 : 0;
  return {
    messages: [...(messages.get(threadId) ?? [])],
    peerName: t.memberNames[peerIndex],
    originExcerpt: t.originExcerpt,
  };
}

/** 发送消息；无权访问返回 null */
export function sendMessage(input: {
  threadId: string;
  sender: SessionUser;
  content: string;
}): Message | null {
  ensureSeeded();

  if (!getMemberThread(input.threadId, input.sender.id)) return null;

  const message: Message = {
    id: randomUUID(),
    threadId: input.threadId,
    senderId: input.sender.id,
    senderName: input.sender.name,
    content: input.content.trim(),
    createdAt: Date.now(),
  };

  const thread = messages.get(input.threadId) ?? [];
  thread.push(message);
  messages.set(input.threadId, thread);

  return message;
}

/** 顶部导航的角标计数 */
export function getBadges(userId: string): {
  incoming: number;
  threads: number;
} {
  ensureSeeded();
  return {
    incoming: listIncoming(userId).length,
    threads: listThreads(userId).length,
  };
}
