import 'server-only';

import {
  ZHIHU_ENDPOINTS,
  ZHIHU_OAUTH_ENDPOINTS,
  getAccessSecret,
  getOAuthBase,
  getOpenApiBase,
  getOAuthAppId,
  getOAuthAppKey,
  getOAuthRedirectUri,
  isAccessSecretConfigured,
} from '@/config/zhihu';
import type {
  ContentsData,
  FolloweesData,
  HotListData,
  OAuthTokenResponse,
  PagedResult,
  SessionUser,
  ZhihuEnvelope,
  ZhihuPaging,
} from '@/lib/types';

/**
 * 知乎开放平台服务端客户端。
 *
 * 鉴权规则（依据开放平台文档）：
 *   - Authorization: Bearer <access_secret>  鉴权「调用方」，每个请求必带
 *   - X-Request-Timestamp: 秒级 Unix 时间戳   每个请求必带
 *   - X-OAuth-Token: <oauth_access_token>    仅在代表已授权用户访问时带上
 *
 * 本模块只在服务端运行（server-only），凭据不会进入浏览器产物。
 */

/** 业务错误，携带开放平台返回的 Code，便于上层区分鉴权失败与限流 */
export class ZhihuApiError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'ZhihuApiError';
  }
}

function buildHeaders(oauthToken?: string): Record<string, string> {
  if (!isAccessSecretConfigured()) {
    throw new ZhihuApiError(
      '尚未配置知乎开放平台 Access Secret，请设置环境变量 ZHIHU_ACCESS_SECRET。',
      -1,
      500,
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${getAccessSecret()}`,
    'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
    'Content-Type': 'application/json',
  };

  if (oauthToken) {
    headers['X-OAuth-Token'] = oauthToken;
  }

  return headers;
}

interface RequestOptions {
  /** 查询参数，值为 undefined 时会被忽略 */
  query?: Record<string, string | number | undefined>;
  /** 代表已授权用户访问时传入 */
  oauthToken?: string;
  /** 缓存秒数，0 表示不缓存 */
  revalidate?: number;
}

/** 发起一次开放平台 GET 请求，并拆掉 { Code, Message, Data } 外层信封 */
async function request<T>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = new URL(endpoint, getOpenApiBase());

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(options.oauthToken),
    next:
      options.revalidate && options.revalidate > 0
        ? { revalidate: options.revalidate }
        : undefined,
    cache: options.revalidate ? undefined : 'no-store',
  });

  const text = await response.text();

  let payload: ZhihuEnvelope<T>;
  try {
    payload = JSON.parse(text) as ZhihuEnvelope<T>;
  } catch {
    throw new ZhihuApiError(
      `知乎接口返回了非 JSON 响应（HTTP ${response.status}）`,
      -1,
      response.status,
    );
  }

  if (payload.Code !== 0) {
    throw new ZhihuApiError(
      describeErrorCode(payload.Code, payload.Message),
      payload.Code,
      response.status,
    );
  }

  return payload.Data;
}

/** 把开放平台错误码翻译成可读文案 */
function describeErrorCode(code: number, message: string): string {
  const table: Record<number, string> = {
    10001: '参数错误',
    20001: '鉴权失败，请检查 Access Secret 或 OAuth Token 是否有效',
    30001: '触发频率限制，请稍后重试',
    30002: '配额已用尽',
    90001: '知乎服务内部错误',
  };
  const known = table[code];
  return known ? `${known}（Code ${code}：${message}）` : `${message}（Code ${code}）`;
}

/**
 * 把服务端的 Paging 归一化为前端易用的分页结果。
 * 协议注意点：请求参数 Offset 是 Int64，响应 NextOffset 却是 String，
 * 这里做严格解析，解析失败时不静默截断，而是按「已到末页」处理。
 */
function normalizePaging<T>(items: T[], paging: ZhihuPaging): PagedResult<T> {
  let nextOffset: number | null = null;

  if (!paging.IsEnd && paging.NextOffset !== undefined) {
    const parsed = Number.parseInt(paging.NextOffset, 10);
    if (Number.isSafeInteger(parsed) && parsed >= 0) {
      nextOffset = parsed;
    }
  }

  return {
    items,
    isEnd: paging.IsEnd || nextOffset === null,
    nextOffset,
    total: paging.Totals ?? items.length,
  };
}

/* -------------------------------------------------------------------------
 * 公共内容能力
 * ---------------------------------------------------------------------- */

/**
 * 获取知乎热榜。
 * Limit 取值 1~30，超出范围服务端会回退为 30。
 */
export async function fetchHotList(limit = 30): Promise<HotListData> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 30, 1), 30);

  return request<HotListData>(ZHIHU_ENDPOINTS.hotList, {
    query: { Limit: safeLimit },
    // 热榜变动不快，缓存 60 秒，避免触发频率限制
    revalidate: 60,
  });
}

/* -------------------------------------------------------------------------
 * 用户数据能力（需要 OAuth Token 才代表登录用户）
 * ---------------------------------------------------------------------- */

/** 获取用户创作内容，支持分页 */
export async function fetchUserContents(params: {
  oauthToken: string;
  offset?: number;
  limit?: number;
  contentType?: string;
  sortField?: 'ts' | 'like_count';
  sortOrder?: 'asc' | 'desc';
}) {
  const data = await request<ContentsData>(ZHIHU_ENDPOINTS.userContents, {
    oauthToken: params.oauthToken,
    query: {
      Offset: params.offset ?? 0,
      Limit: Math.min(Math.max(params.limit ?? 20, 1), 50),
      ContentType: params.contentType ?? 'all',
      SortField: params.sortField ?? 'ts',
      SortOrder: params.sortOrder ?? 'desc',
    },
  });

  return normalizePaging(data.Items ?? [], data.Paging);
}

/** 获取用户关注的人，支持分页 */
export async function fetchUserFollowees(params: {
  oauthToken: string;
  offset?: number;
  limit?: number;
}) {
  const data = await request<FolloweesData>(ZHIHU_ENDPOINTS.userFollowees, {
    oauthToken: params.oauthToken,
    query: {
      Offset: params.offset ?? 0,
      Limit: Math.min(Math.max(params.limit ?? 20, 1), 50),
    },
  });

  return normalizePaging(data.Items ?? [], data.Paging);
}

/* -------------------------------------------------------------------------
 * OAuth 能力
 * ---------------------------------------------------------------------- */

/** 构造知乎授权页地址 */
export function buildAuthorizeUrl(state: string): string {
  const url = new URL(ZHIHU_OAUTH_ENDPOINTS.authorize, getOAuthBase());
  url.searchParams.set('app_id', getOAuthAppId());
  url.searchParams.set('redirect_uri', getOAuthRedirectUri());
  url.searchParams.set('response_type', 'code');
  // 黑客松 OAuth 已支持 state 原样透传，用于回调时校验登录请求关联性
  url.searchParams.set('state', state);
  return url.toString();
}

/**
 * 用授权码换取用户 access_token。
 *
 * 协议要点（已核对实测记录）：
 *   - 回调参数名是 authorization_code，但 token 接口的表单字段仍叫 code；
 *   - 成功响应里业务码 20000 表示成功，不能当作错误，应优先检查 access_token 是否存在。
 */
export async function exchangeCodeForToken(
  code: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const body = new URLSearchParams({
    app_id: getOAuthAppId(),
    app_key: getOAuthAppKey(),
    grant_type: 'authorization_code',
    redirect_uri: getOAuthRedirectUri(),
    code,
  });

  const response = await fetch(
    new URL(ZHIHU_OAUTH_ENDPOINTS.accessToken, getOAuthBase()),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
    },
  );

  const text = await response.text();

  let payload: OAuthTokenResponse;
  try {
    payload = JSON.parse(text) as OAuthTokenResponse;
  } catch {
    throw new ZhihuApiError(
      `换取 access_token 失败：响应不是 JSON（HTTP ${response.status}）`,
      -1,
      response.status,
    );
  }

  // 优先检查 access_token 是否存在，而不是先判业务码
  if (!payload.access_token) {
    throw new ZhihuApiError(
      payload.message ?? '换取 access_token 失败，响应中没有 access_token',
      payload.code ?? -1,
      response.status,
    );
  }

  return {
    accessToken: payload.access_token,
    expiresIn: payload.expires_in ?? 3600,
  };
}

/**
 * 获取已授权用户的基础信息。
 *
 * 依据黑客松《获取授权用户基础信息》接口：
 *   GET https://openapi.zhihu.com/user
 *   Authorization: Bearer <OAuth access_token>
 * 该接口不需要 Access Secret、X-OAuth-Token 或时间戳。
 *
 * 两个协议要点：
 *   1. 不能只凭 HTTP 200 判断成功，需确认响应含有效用户标识；
 *      历史错误形态为 HTTP 200 + {"code":404,"data":"User don't exist"}。
 *   2. uid 是 int64，可能超出 JavaScript 安全整数范围，必须在 JSON 解析
 *      阶段就无损取出（这里用正则从原始文本提取），不能先 JSON.parse 成
 *      Number 再转字符串，否则末位会被舍入。
 */
export async function fetchOAuthUserProfile(
  accessToken: string,
): Promise<SessionUser | null> {
  try {
    const response = await fetch(
      new URL(ZHIHU_OAUTH_ENDPOINTS.user, getOAuthBase()),
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      },
    );

    if (!response.ok) return null;

    const text = await response.text();

    // 先从原始 JSON 文本中无损提取 uid，避免 Number 精度丢失
    const rawUid = text.match(/"uid"\s*:\s*"?(\d+)"?/)?.[1] ?? '';

    const raw = JSON.parse(text) as Record<string, unknown>;

    // 兼容 { data: {...} } 包裹与顶层直出两种形态
    const nested =
      raw.data && typeof raw.data === 'object'
        ? (raw.data as Record<string, unknown>)
        : undefined;
    const node = nested ?? raw;

    const pick = (...keys: string[]): string => {
      for (const key of keys) {
        const value = node[key];
        if (typeof value === 'string' && value.length > 0) return value;
      }
      return '';
    };

    const hashId = pick('hash_id');
    const fullname = pick('fullname');

    // 必须确认存在有效用户标识，不能用空对象建立登录会话
    if (!rawUid && !hashId && !fullname) return null;

    return {
      id: rawUid || hashId || fullname,
      hashId,
      name: fullname || '知乎用户',
      avatarUrl: pick('avatar_path'),
      headline: pick('headline', 'description'),
      url: hashId ? `https://www.zhihu.com/people/${hashId}` : pick('url'),
    };
  } catch {
    return null;
  }
}
