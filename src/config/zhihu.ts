/**
 * 知乎开放平台凭据与接口地址配置
 *
 * ⚠️ 凭据注入方式（部署前必读）
 * -------------------------------------------------------------------------
 * 本文件**不包含任何明文凭据**，可安全提交到代码仓库。
 * 所有机密值一律通过环境变量注入：
 *   - 本地开发：写在 `.env.local`（已被 .gitignore 忽略，Next.js 自动加载）
 *   - 线上部署：在 Vercel 项目的 Environment Variables 中配置
 *
 * 这样做的原因：部署到 Vercel 需要把代码推送到 Git 仓库，
 * 若凭据写在源码里，要么泄露，要么因文件被忽略而导致构建失败。
 *
 * 接口地址与协议依据 zhihu-cli 的 `capabilities` 输出以及开放平台文档核对：
 *   - 内容接口：https://developer.zhihu.com/api/v1/content/*
 *   - 用户接口：https://developer.zhihu.com/api/v1/user/*
 *   - OAuth   ：https://openapi.zhihu.com/authorize、/access_token
 */

/**
 * 读取配置项：优先运行时环境变量，其次回退值（仅用于非机密的接口地址）。
 *
 * ⚠️ 必须通过函数在运行时读取 process.env。
 * 若写成模块顶层的 `process.env.X ?? '默认值'`，Next.js 在 build 阶段会把
 * 整个表达式静态内联为「默认值」，导致部署后设置环境变量完全失效。
 */
function readConfig(envKey: string, fallback: string): string {
  const fromEnv =
    typeof process !== 'undefined' ? process.env[envKey] : undefined;
  return fromEnv && fromEnv.length > 0 ? fromEnv : fallback;
}

/**
 * 开放平台 Access Secret（Bearer 凭证），用于鉴权「调用方」。
 * 机密值，必须由环境变量 ZHIHU_ACCESS_SECRET 提供。
 */
export const getAccessSecret = (): string =>
  readConfig('ZHIHU_ACCESS_SECRET', '');

/**
 * OAuth 应用 ID，代表「第三方应用」身份。
 * 由知乎黑客松 2026「校园新锐季」赛事页面分配，经环境变量注入。
 */
export const getOAuthAppId = (): string => readConfig('ZHIHU_OAUTH_APP_ID', '');

/**
 * OAuth 应用密钥，仅允许在服务端换取 access_token。
 * 机密值，必须由环境变量 ZHIHU_OAUTH_APP_KEY 提供。
 */
export const getOAuthAppKey = (): string =>
  readConfig('ZHIHU_OAUTH_APP_KEY', '');

/**
 * OAuth 回调地址，必须与赛事页面登记的 redirect_uri **完全一致**
 * （协议、域名、端口、路径、尾斜杠逐字符相同），否则换取 token 会被拒绝。
 *
 * 线上须设置为公网 HTTPS 地址，例如：
 *   https://<your-app>.vercel.app/api/auth/callback
 */
export const getOAuthRedirectUri = (): string =>
  readConfig(
    'ZHIHU_OAUTH_REDIRECT_URI',
    'http://localhost:3000/api/auth/callback',
  );

/** 用于给会话 Cookie 签名，生产部署必须设置为随机长字符串 */
export const getSessionSecret = (): string =>
  readConfig('SESSION_SECRET', '');

/**
 * 开放平台内容与用户数据接口基址。
 * 支持用 ZHIHU_OPEN_API_BASE 覆盖，便于自托管代理或本地联调。
 */
export const getOpenApiBase = (): string =>
  readConfig('ZHIHU_OPEN_API_BASE', 'https://developer.zhihu.com');

/** OAuth 授权与 token 交换接口基址 */
export const getOAuthBase = (): string =>
  readConfig('ZHIHU_OAUTH_BASE', 'https://openapi.zhihu.com');

export const ZHIHU_ENDPOINTS = {
  hotList: '/api/v1/content/hot_list',
  zhihuSearch: '/api/v1/content/zhihu_search',
  globalSearch: '/api/v1/content/global_search',
  userContents: '/api/v1/user/contents',
  userFollowees: '/api/v1/user/followees',
  userFavlists: '/api/v1/user/favlists',
  userCollections: '/api/v1/user/collections',
} as const;

export const ZHIHU_OAUTH_ENDPOINTS = {
  authorize: '/authorize',
  accessToken: '/access_token',
  /**
   * 用户信息接口。开放平台公开文档未给出该接口的正式 schema，
   * 此处按实测约定（响应业务码 20000 表示成功）实现，并在
   * src/lib/zhihu.ts 中做了「取不到就降级」的兜底处理。
   */
  user: '/user',
} as const;

/** 判断 Access Secret 是否已注入 */
export function isAccessSecretConfigured(): boolean {
  return getAccessSecret().length > 0;
}

/** 判断 OAuth 应用凭据是否已注入 */
export function isOAuthConfigured(): boolean {
  return getOAuthAppId().length > 0 && getOAuthAppKey().length > 0;
}
