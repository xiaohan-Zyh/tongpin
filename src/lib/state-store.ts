import 'server-only';

import { setIfAbsent } from '@/lib/kv';

/**
 * 已消费的 OAuth state 记录（防重放）。
 *
 * 为什么需要：
 *   `cookies().delete()` 只是让浏览器丢弃 Cookie，无法阻止攻击者
 *   用抓到的 state + Cookie 反复向回调地址提交同一个授权码。
 *   必须在服务端记录已使用过的 state，做真正的一次性消费。
 *
 * 为什么必须用 SET NX：
 *   多实例环境下「先查询再写入」存在竞态——两个并发请求可能同时
 *   查到「未使用」，双双通过校验。Redis 的 SET NX 是单条原子命令，
 *   只有第一个写入者成功，天然满足一次性语义。
 *
 * 存储位置：接入 Redis 时跨实例共享；未接入时回退进程内存
 * （单实例仍有效，多实例下降级，详见 README 说明）。
 */

const KEY_PREFIX = 'tongpin:state:';

/**
 * 尝试消费一个 state。
 *
 * @returns true 表示首次使用（允许继续）；false 表示已被用过（应拒绝）
 */
export async function consumeStateOnce(
  state: string,
  ttlMs: number,
): Promise<boolean> {
  try {
    return await setIfAbsent(`${KEY_PREFIX}${state}`, '1', ttlMs);
  } catch {
    // 存储层故障时保守拒绝：宁可让用户重新登录，也不放过潜在重放。
    return false;
  }
}
