import 'server-only';

/**
 * 「同频」领域模型与数据仓库。
 *
 * 存储选型说明：
 * 数据通过 `@/lib/kv` 持久化。接入 Upstash Redis 后跨实例共享，
 * 满足 Vercel 多实例 Serverless 架构的需求；未接入时自动回退进程内存，
 * 保证本地开发与自动化测试无需依赖外部服务。
 *
 * 数据布局（Redis 结构）：
 *   tongpin:opinions          Hash   观点 id -> JSON
 *   tongpin:requests          Hash   请求 id -> JSON
 *   tongpin:threads           Hash   对话 id -> JSON
 *   tongpin:messages:<id>     List   该对话的消息 JSON 列表
 *   tongpin:seeded            String 种子数据初始化标记（SET NX 保证只写一次）
 *
 * 为什么用 Hash 而非一个大 JSON：
 * 单条写入只影响一个 field，避免并发写互相覆盖。
 *
 * 所有读写函数均为异步，函数签名即为将来替换其他存储的接口边界。
 */

import { randomUUID } from 'node:crypto';

import { buildIdf, similarity, tokenize } from '@/lib/similarity';
import {
  hdel,
  hgetall,
  hget,
  hset,
  lrangeAll,
  rpush,
  setIfAbsent,
} from '@/lib/kv';
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
  opinionId: string;
  opinionExcerpt: string;
  greeting: string;
  status: RequestStatus;
  createdAt: number;
  respondedAt: number | null;
}

/** 对话线程：双向同意后才会创建 */
export interface Thread {
  id: string;
  memberIds: string[];
  memberNames: string[];
  /** 来源观点摘要，提示「你们因何相识」 */
  originExcerpt: string;
  createdAt: number;
}

export interface Message {
  id: string;
  threadId: string;
  senderId: string;
  senderName: string;
  content: string;
  createdAt: number;
}

/** 对话列表项 */
export interface ThreadSummary {
  id: string;
  peerName: string;
  originExcerpt: string;
  lastMessage: string;
  lastMessageAt: number;
  messageCount: number;
  /** 对方发来、且本人尚未读过的消息数；用于列表红点 */
  unreadCount: number;
}

/* =========================================================================
 * 存储键与原语
 * ====================================================================== */

const K_OPINIONS = 'tongpin:opinions';
const K_REQUESTS = 'tongpin:requests';
const K_THREADS = 'tongpin:threads';
const K_SEEDED = 'tongpin:seeded';
const kMessages = (threadId: string) => `tongpin:messages:${threadId}`;

/**
 * 已读水位：记录某人在某个会话中最后一次读到的时间点。
 *
 * 之所以存「时间戳」而不是「未读条数」：
 * 计数需要在每次发消息时对所有成员做自增，写放大且容易错乱；
 * 水位只在「本人打开会话」时写一次，未读数由消息时间比对算出，
 * 天然幂等，多端打开也不会互相覆盖出错。
 */
const kRead = (userId: string) => `tongpin:read:${userId}`;

/** 相似度门槛：低于此值视为不相关，宁可不给结果也不用低质量内容凑数 */
export const MATCH_THRESHOLD = 0.05;

/** 读取哈希表中全部实体，跳过解析失败的脏数据而不是整体崩溃 */
async function readAll<T>(key: string): Promise<T[]> {
  const raw = await hgetall(key);
  const out: T[] = [];

  for (const value of Object.values(raw)) {
    try {
      out.push(JSON.parse(value) as T);
    } catch {
      // 单条脏数据不应导致整个列表不可用
    }
  }
  return out;
}

async function readOne<T>(key: string, id: string): Promise<T | null> {
  const raw = await hget(key, id);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeOne(
  key: string,
  id: string,
  value: unknown,
): Promise<void> {
  await hset(key, id, JSON.stringify(value));
}

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

/**
 * 写入演示用种子观点，保证评委打开即可看到真实的匹配效果，
 * 无需先注册多个账号互相发帖。
 *
 * 用 SET NX 抢占初始化权：多实例并发冷启动时只有一个实例真正写入，
 * 避免种子数据被重复写成多份。
 */
async function ensureSeeded(): Promise<void> {
  const isFirst = await setIfAbsent(K_SEEDED, String(Date.now()));
  if (!isFirst) return;

  const now = Date.now();
  for (const s of SEEDS) {
    const at = now - s.daysAgo * 86_400_000;
    const id = `seed_${s.id}`;

    await writeOne(K_OPINIONS, id, {
      id,
      authorId: s.id,
      authorName: s.name,
      authorAvatar: '',
      content: s.content,
      topic: s.topic,
      visibility: 'public',
      createdAt: at,
      updatedAt: at,
    } satisfies Opinion);
  }
}

/* =========================================================================
 * 观点
 * ====================================================================== */

export async function createOpinion(input: {
  author: SessionUser;
  content: string;
  topic: string;
  visibility: Visibility;
}): Promise<Opinion> {
  await ensureSeeded();

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

  await writeOne(K_OPINIONS, opinion.id, opinion);
  return opinion;
}

export async function getOpinion(id: string): Promise<Opinion | null> {
  await ensureSeeded();
  return readOne<Opinion>(K_OPINIONS, id);
}

/** 我的全部观点（含仅自己可见），按时间倒序 */
export async function listMyOpinions(userId: string, offset = 0, limit = 10) {
  await ensureSeeded();

  const all = (await readAll<Opinion>(K_OPINIONS))
    .filter((o) => o.authorId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);

  return { items: all.slice(offset, offset + limit), total: all.length };
}

/** 公开广场，包含本人发布的公开内容 */
export async function listSquare(_viewerId: string, offset = 0, limit = 10) {
  await ensureSeeded();

  const all = (await readAll<Opinion>(K_OPINIONS))
    .filter((o) => o.visibility === 'public')
    .sort((a, b) => b.createdAt - a.createdAt);

  return { items: all.slice(offset, offset + limit), total: all.length };
}

/** 删除观点；仅作者本人可操作，返回是否实际删除了内容 */
export async function deleteOpinion(
  opinionId: string,
  userId: string,
): Promise<boolean> {
  await ensureSeeded();

  const o = await readOne<Opinion>(K_OPINIONS, opinionId);
  if (!o || o.authorId !== userId) return false;

  await hdel(K_OPINIONS, opinionId);
  return true;
}

/** 切换可见性；仅作者本人可操作 */
export async function updateVisibility(
  opinionId: string,
  userId: string,
  visibility: Visibility,
): Promise<Opinion | null> {
  await ensureSeeded();

  const o = await readOne<Opinion>(K_OPINIONS, opinionId);
  if (!o || o.authorId !== userId) return null;

  o.visibility = visibility;
  o.updatedAt = Date.now();
  await writeOne(K_OPINIONS, o.id, o);

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
export async function findMatches(
  sourceId: string,
  viewerId: string,
  limit = 5,
): Promise<MatchResult[]> {
  await ensureSeeded();

  const all = await readAll<Opinion>(K_OPINIONS);
  const source = all.find((o) => o.id === sourceId);
  if (!source || source.visibility !== 'public') return [];

  const candidates = all.filter(
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
function findLiveRequest(
  all: ContactRequest[],
  a: string,
  b: string,
  opinionId: string,
): ContactRequest | undefined {
  return all.find(
    (r) =>
      r.opinionId === opinionId &&
      r.status !== 'declined' &&
      ((r.fromId === a && r.toId === b) || (r.fromId === b && r.toId === a)),
  );
}

export async function createRequest(input: {
  from: SessionUser;
  opinionId: string;
  greeting: string;
}): Promise<
  { ok: true; request: ContactRequest } | { ok: false; reason: string }
> {
  await ensureSeeded();

  const opinion = await readOne<Opinion>(K_OPINIONS, input.opinionId);
  if (!opinion) return { ok: false, reason: '该观点不存在或已被删除。' };
  if (opinion.visibility !== 'public') {
    return { ok: false, reason: '该观点未公开，无法发起交流。' };
  }
  if (opinion.authorId === input.from.id) {
    return { ok: false, reason: '不能向自己发起交流。' };
  }

  const all = await readAll<ContactRequest>(K_REQUESTS);
  const live = findLiveRequest(all, input.from.id, opinion.authorId, opinion.id);
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

  await writeOne(K_REQUESTS, request.id, request);
  return { ok: true, request };
}

/** 我收到的待处理请求 */
export async function listIncoming(userId: string): Promise<ContactRequest[]> {
  await ensureSeeded();

  return (await readAll<ContactRequest>(K_REQUESTS))
    .filter((r) => r.toId === userId && r.status === 'pending')
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** 我发出的请求 */
export async function listOutgoing(userId: string): Promise<ContactRequest[]> {
  await ensureSeeded();

  return (await readAll<ContactRequest>(K_REQUESTS))
    .filter((r) => r.fromId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 响应交流请求。接受后创建对话线程，并把打招呼的话作为第一条消息。
 * 仅接收方本人可处理，且只能处理一次。
 */
export async function respondRequest(input: {
  requestId: string;
  userId: string;
  accept: boolean;
}): Promise<
  | { ok: true; request: ContactRequest; threadId: string | null }
  | { ok: false; reason: string }
> {
  await ensureSeeded();

  const request = await readOne<ContactRequest>(K_REQUESTS, input.requestId);
  if (!request) return { ok: false, reason: '该请求不存在。' };
  if (request.toId !== input.userId) {
    return { ok: false, reason: '只有被邀请方可以处理该请求。' };
  }
  if (request.status !== 'pending') {
    return { ok: false, reason: '该请求已经处理过了。' };
  }

  request.status = input.accept ? 'accepted' : 'declined';
  request.respondedAt = Date.now();
  await writeOne(K_REQUESTS, request.id, request);

  if (!input.accept) return { ok: true, request, threadId: null };

  const thread: Thread = {
    id: randomUUID(),
    memberIds: [request.fromId, request.toId],
    memberNames: [request.fromName, request.toName],
    originExcerpt: request.opinionExcerpt,
    createdAt: Date.now(),
  };
  await writeOne(K_THREADS, thread.id, thread);

  // 招呼语成为对话的第一条消息，让对话不是从空白开始
  const first: Message = {
    id: randomUUID(),
    threadId: thread.id,
    senderId: request.fromId,
    senderName: request.fromName,
    content: request.greeting || '你好，很高兴遇到想法相似的人。',
    createdAt: request.createdAt,
  };
  await rpush(kMessages(thread.id), JSON.stringify(first));

  return { ok: true, request, threadId: thread.id };
}

/* =========================================================================
 * 对话
 * ====================================================================== */

/** 仅线程成员可访问 */
async function getMemberThread(
  threadId: string,
  userId: string,
): Promise<Thread | null> {
  const t = await readOne<Thread>(K_THREADS, threadId);
  if (!t || !t.memberIds.includes(userId)) return null;
  return t;
}

/** 读取某个对话的全部消息 */
async function readMessages(threadId: string): Promise<Message[]> {
  const raw = await lrangeAll(kMessages(threadId));
  const out: Message[] = [];

  for (const item of raw) {
    try {
      out.push(JSON.parse(item) as Message);
    } catch {
      // 跳过脏数据
    }
  }
  return out;
}

/** 读取本人在各会话的已读水位：threadId -> 时间戳 */
async function readWatermarks(userId: string): Promise<Record<string, number>> {
  const raw = await hgetall(kRead(userId));
  const out: Record<string, number> = {};

  for (const [threadId, value] of Object.entries(raw)) {
    const n = Number(value);
    if (Number.isFinite(n)) out[threadId] = n;
  }
  return out;
}

/**
 * 把某个会话标记为已读（把水位推到当前时间）。
 * 仅会话成员可操作，非成员返回 false。
 */
export async function markThreadRead(
  threadId: string,
  userId: string,
): Promise<boolean> {
  const t = await getMemberThread(threadId, userId);
  if (!t) return false;

  await hset(kRead(userId), threadId, String(Date.now()));
  return true;
}

export async function listThreads(userId: string): Promise<ThreadSummary[]> {
  await ensureSeeded();

  const mine = (await readAll<Thread>(K_THREADS)).filter((t) =>
    t.memberIds.includes(userId),
  );

  const watermarks = await readWatermarks(userId);

  const summaries = await Promise.all(
    mine.map(async (t) => {
      const msgs = await readMessages(t.id);
      const last = msgs[msgs.length - 1];
      const peerIndex = t.memberIds[0] === userId ? 1 : 0;

      // 只有「对方发的」且「晚于已读水位」的消息才算未读；
      // 自己发的消息永远不该让自己看到红点
      const readAt = watermarks[t.id] ?? 0;
      const unreadCount = msgs.filter(
        (m) => m.senderId !== userId && m.createdAt > readAt,
      ).length;

      return {
        id: t.id,
        peerName: t.memberNames[peerIndex],
        originExcerpt: t.originExcerpt,
        lastMessage: last?.content ?? '',
        lastMessageAt: last?.createdAt ?? t.createdAt,
        messageCount: msgs.length,
        unreadCount,
      };
    }),
  );

  return summaries.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

/**
 * 读取消息；无权访问返回 null。
 *
 * 读取即视为已读：会顺带把该会话的已读水位推到当前时间，
 * 使对应红点在用户点开对话后自动消失。
 */
export async function listMessages(
  threadId: string,
  userId: string,
): Promise<{
  messages: Message[];
  peerName: string;
  originExcerpt: string;
} | null> {
  await ensureSeeded();

  const t = await getMemberThread(threadId, userId);
  if (!t) return null;

  const peerIndex = t.memberIds[0] === userId ? 1 : 0;
  const messages = await readMessages(threadId);

  // 先取完消息再更新水位，避免把「本次尚未返回给用户的消息」也标成已读
  await hset(kRead(userId), threadId, String(Date.now()));

  return {
    messages,
    peerName: t.memberNames[peerIndex],
    originExcerpt: t.originExcerpt,
  };
}

/** 发送消息；无权访问返回 null */
export async function sendMessage(input: {
  threadId: string;
  sender: SessionUser;
  content: string;
}): Promise<Message | null> {
  await ensureSeeded();

  if (!(await getMemberThread(input.threadId, input.sender.id))) return null;

  const message: Message = {
    id: randomUUID(),
    threadId: input.threadId,
    senderId: input.sender.id,
    senderName: input.sender.name,
    content: input.content.trim(),
    createdAt: Date.now(),
  };

  await rpush(kMessages(input.threadId), JSON.stringify(message));
  return message;
}

/** 顶部导航的角标计数 */
export async function getBadges(userId: string): Promise<{
  incoming: number;
  threads: number;
}> {
  await ensureSeeded();

  const [incoming, threads] = await Promise.all([
    listIncoming(userId),
    listThreads(userId),
  ]);

  // 「对话」角标表示有多少个会话存在未读消息，而不是会话总数——
  // 否则读完所有消息后角标依然常亮，失去提醒意义
  const unreadThreads = threads.filter((t) => t.unreadCount > 0).length;

  return { incoming: incoming.length, threads: unreadThreads };
}
