import 'server-only';

/**
 * 极简 KV 抽象层：优先使用 Upstash Redis，未配置时自动回退到进程内存。
 *
 * 为什么需要这一层：
 *   Vercel 是多实例 Serverless 架构，实例随时被回收，进程内存不保证跨请求保留。
 *   业务数据放在内存里会出现「发表的观点刷新后消失」这类问题。
 *
 * 为什么不引第三方 SDK：
 *   Upstash 提供标准 REST 接口，用内置 fetch 直接调用即可，
 *   零依赖、无版本冲突风险，也不受本地 npm 镜像源限制。
 *
 * 环境变量（Vercel 接入 Upstash 集成后会自动注入，两套命名都兼容）：
 *   KV_REST_API_URL / KV_REST_API_TOKEN               （Vercel 集成注入）
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN （Upstash 官方命名）
 *
 * 未配置时回退内存：本地开发与自动化测试无需依赖外部服务，
 * 行为与线上一致，只是不跨实例共享。
 */

/* =========================================================================
 * 配置读取（必须运行时读取，避免 Next.js 构建期静态内联）
 * ====================================================================== */

function readEnv(...keys: string[]): string {
  if (typeof process === 'undefined') return '';
  for (const k of keys) {
    const v = process.env[k];
    if (v && v.length > 0) return v;
  }
  return '';
}

const getRestUrl = (): string =>
  readEnv('KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL').replace(/\/+$/, '');

const getRestToken = (): string =>
  readEnv('KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN');

/** 是否已接入 Redis。未接入时全部操作走内存实现。 */
export function isRedisConfigured(): boolean {
  return getRestUrl().length > 0 && getRestToken().length > 0;
}

/* =========================================================================
 * Redis 实现（Upstash REST）
 * ====================================================================== */

class KvError extends Error {}

/**
 * 执行一条 Redis 命令。
 * Upstash REST 协议：POST 到根地址，body 为命令数组，响应为 { result }。
 */
async function command<T>(args: (string | number)[]): Promise<T> {
  const response = await fetch(getRestUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getRestToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    cache: 'no-store',
  });

  const text = await response.text();

  let payload: { result?: T; error?: string };
  try {
    payload = JSON.parse(text) as { result?: T; error?: string };
  } catch {
    throw new KvError(`Redis 返回了非 JSON 响应（HTTP ${response.status}）`);
  }

  if (payload.error) throw new KvError(payload.error);
  return payload.result as T;
}

/* =========================================================================
 * 内存回退实现
 * ====================================================================== */

const memHash = new Map<string, Map<string, string>>();
const memList = new Map<string, string[]>();
/** key -> 过期时间戳（毫秒）；0 表示永不过期 */
const memExpire = new Map<string, number>();

function memAlive(key: string): boolean {
  const exp = memExpire.get(key);
  if (exp === undefined) return true;
  if (exp === 0) return true;
  if (exp > Date.now()) return true;

  memExpire.delete(key);
  memHash.delete(key);
  memList.delete(key);
  return false;
}

/* =========================================================================
 * 对外接口
 * ====================================================================== */

/** 读取整个哈希表，返回 field -> value */
export async function hgetall(key: string): Promise<Record<string, string>> {
  if (!isRedisConfigured()) {
    const h = memHash.get(key);
    return h ? Object.fromEntries(h) : {};
  }

  // Upstash 返回扁平数组 [field1, value1, field2, value2, ...]
  const flat = await command<string[] | null>(['HGETALL', key]);
  if (!flat || flat.length === 0) return {};

  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < flat.length; i += 2) {
    out[flat[i]] = flat[i + 1];
  }
  return out;
}

/** 读取哈希表中的单个字段 */
export async function hget(key: string, field: string): Promise<string | null> {
  if (!isRedisConfigured()) {
    return memHash.get(key)?.get(field) ?? null;
  }
  return command<string | null>(['HGET', key, field]);
}

/** 写入哈希表字段 */
export async function hset(
  key: string,
  field: string,
  value: string,
): Promise<void> {
  if (!isRedisConfigured()) {
    const h = memHash.get(key) ?? new Map<string, string>();
    h.set(field, value);
    memHash.set(key, h);
    return;
  }
  await command(['HSET', key, field, value]);
}

/** 删除哈希表中的一个字段 */
export async function hdel(key: string, field: string): Promise<void> {
  if (!isRedisConfigured()) {
    memHash.get(key)?.delete(field);
    return;
  }
  await command(['HDEL', key, field]);
}

/** 向列表尾部追加元素 */
export async function rpush(key: string, value: string): Promise<void> {
  if (!isRedisConfigured()) {
    const l = memList.get(key) ?? [];
    l.push(value);
    memList.set(key, l);
    return;
  }
  await command(['RPUSH', key, value]);
}

/** 读取整个列表 */
export async function lrangeAll(key: string): Promise<string[]> {
  if (!isRedisConfigured()) {
    return [...(memList.get(key) ?? [])];
  }
  return (await command<string[] | null>(['LRANGE', key, 0, -1])) ?? [];
}

/**
 * 原子性地「首次占位」：key 不存在时写入并返回 true，已存在返回 false。
 *
 * 这是 OAuth state 一次性消费与种子数据初始化的关键原语，
 * 必须依赖 Redis 的 SET NX 保证跨实例原子性，不能用「先读后写」模拟。
 *
 * @param ttlMs 过期毫秒数；传 0 表示永不过期
 */
export async function setIfAbsent(
  key: string,
  value: string,
  ttlMs = 0,
): Promise<boolean> {
  if (!isRedisConfigured()) {
    if (memAlive(key) && memExpire.has(key)) return false;

    memExpire.set(key, ttlMs > 0 ? Date.now() + ttlMs : 0);
    return true;
  }

  const args: (string | number)[] = ['SET', key, value, 'NX'];
  if (ttlMs > 0) args.push('PX', ttlMs);

  // 成功返回 "OK"，键已存在返回 null
  const result = await command<string | null>(args);
  return result === 'OK';
}
