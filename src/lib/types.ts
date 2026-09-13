/** 开放平台统一响应外层结构 */
export interface ZhihuEnvelope<T> {
  Code: number;
  Message: string;
  Data: T;
}

/** 分页信息。注意：NextOffset 服务端返回的是 String */
export interface ZhihuPaging {
  IsEnd: boolean;
  NextOffset?: string;
  Totals: number;
}

/** 热榜条目 */
export interface HotItem {
  Title: string;
  Url: string;
  ThumbnailUrl: string;
  Summary: string;
}

export interface HotListData {
  Total: number;
  Items: HotItem[];
}

/** 用户创作内容 */
export interface ContentItem {
  ContentType: 'answer' | 'article' | 'zvideo' | 'pin' | 'question' | string;
  Url: string;
  CreatedAt: number;
  LikeCount: number;
  CommentCount: number;
  FavoriteCount: number;
  Title: string;
  Summary: string;
}

export interface ContentsData {
  Items: ContentItem[];
  Paging: ZhihuPaging;
}

/** 关注的人 */
export interface FolloweeItem {
  Fullname: string;
  UrlToken: string;
  Url: string;
  AvatarUrl: string;
  Headline: string;
  /** 0 未知或保密，1 女性，2 男性 */
  Gender: number;
  FollowerCount: number;
}

export interface FolloweesData {
  Items: FolloweeItem[];
  Paging: ZhihuPaging;
}

/** OAuth token 交换响应 */
export interface OAuthTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  /** 实测：业务码 20000 表示成功，不应当作错误 */
  code?: number;
  message?: string;
}

/** 登录用户在会话中保存的画像 */
export interface SessionUser {
  /** 用户唯一标识（uid 的无损字符串形式，回退 hash_id） */
  id: string;
  /** 用户字符串标识 hash_id */
  hashId: string;
  name: string;
  avatarUrl: string;
  headline: string;
  url: string;
}

/** 会话负载 */
export interface SessionPayload {
  user: SessionUser;
  accessToken: string;
  /** 毫秒时间戳 */
  expiresAt: number;
}

/** 前端统一分页响应 */
export interface PagedResult<T> {
  items: T[];
  isEnd: boolean;
  nextOffset: number | null;
  total: number;
}
