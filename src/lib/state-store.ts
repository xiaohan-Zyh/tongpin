import 'server-only';

/**
 * 已消费的 OAuth state 服务端记录（防重放）。
 *
 * 为什么需要：`cookies().delete()` 只是让浏览器丢弃 Cookie，无法阻止
 * 攻击者用抓到的 state + Cookie 反复向回调地址提交同一个授权码。
 * 因此必须在服务端记录已使用过的 state，做真正的一次性消费。
 *
 * 适用范围：常驻单进程 Demo 使用进程内存即可；多实例或 Serverless 部署
 * 需要替换为 Redis、数据库等共享存储，否则不同实例之间无法互相拦截。
 */

/** state -> 过期时间（毫秒时间戳） */
const consumed = new Map<string, number>();

/** 清理已过期的记录，避免内存无界增长 */
function sweep(now: number): void {
  for (const [key, expiresAt] of consumed) {
    if (expiresAt <= now) consumed.delete(key);
  }
}

/**
 * 尝试消费一个 state。
 * @returns true 表示首次使用（允许继续）；false 表示已被用过（应拒绝）
 */
export function consumeStateOnce(state: string, ttlMs: number): boolean {
  const now = Date.now();
  sweep(now);

  if (consumed.has(state)) return false;

  consumed.set(state, now + ttlMs);
  return true;
}
