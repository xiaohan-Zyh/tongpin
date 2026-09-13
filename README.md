# 同频 · Next.js 全栈项目

基于 **Next.js 15 App Router** 的全栈应用，对接知乎开放平台。
一个把「记录自己」和「找到同频的人」连起来的观点社交产品。

**知乎能力接入**
- 首页服务端渲染**知乎热榜**（hot_list 接口，每 60 秒重新获取）
- 接入**知乎 OAuth 登录**，登录用户显示在页面右上角
- 个人页展示用户信息、**关注的人**与**创作内容**，支持「加载更多」分页

**同频核心功能**（`/tongpin`）
- **发表观点**：可见性（公开 / 仅自己可见）与是否立即匹配两个**正交**选择
- **观点匹配**：TF-IDF + 概念词典两层算法，展示相似度与命中理由
- **交流请求**：匹配到观点后发起，**对方同意才开启对话**
- **对话**：双向同意后的一对一聊天
- **可见性随时切换**：公开 ↔ 仅自己可见，转私密后立即退出匹配池

---

## 快速开始

```bash
npm install
npm run dev      # http://localhost:3000
```

> 注意：本机 npm 默认配置了 `omit=dev`。若 `tsc` 等开发依赖缺失，请用
> `npm install --include=dev` 安装。

生产构建：

```bash
npm run build
npm run start
```

---

## 一、配置凭据（必读）

所有凭据集中在 **`src/config/zhihu.ts`**，按需求直接写在源码中，便于项目独立部署。

| 配置项 | 说明 | 当前状态 |
|---|---|---|
| `ZHIHU_ACCESS_SECRET` | 开放平台 Access Secret，鉴权**调用方** | ✅ 已通过 `zhihu-cli` 配置到系统凭证库 |
| `ZHIHU_OAUTH_APP_ID` | OAuth 应用 ID，赛事页面分配 | ⚠️ **待赛事页面提供** |
| `ZHIHU_OAUTH_APP_KEY` | OAuth 应用密钥，赛事页面分配 | ⚠️ **待赛事页面提供** |
| `ZHIHU_OAUTH_REDIRECT_URI` | 回调地址，**必须与申请时登记的完全一致** | `http://localhost:3000/api/auth/callback` |
| `SESSION_SECRET` | 会话 Cookie 签名密钥，部署前请换成随机长字符串 | 默认值 |

### 1. Access Secret

Access Secret 已通过 `zhihu-cli auth set` 保存到**操作系统凭证库**并验证有效
（掩码 `6144...a1b2`）。CLI 不输出明文，因此运行本项目时需通过环境变量提供：

```bash
ZHIHU_ACCESS_SECRET=<你的 Access Secret> npm run start
```

未提供时，首页会显示明确的配置引导，而不是白屏或报错。

### 2. OAuth 凭据（已配置）

黑客松的 `app_id` / `app_key` 由**赛事页面分配**，不走通用邮件申请流程。

当前项目已填入赛事分配的凭据（`src/config/zhihu.ts`，该文件已在 `.gitignore` 中忽略）：

- `app_id`：`471`
- `app_key`：仅存于服务端配置，不出现在客户端产物中

已实测确认：授权地址 `https://openapi.zhihu.com/authorize?app_id=471&...` 被知乎正常受理
（302 跳转到知乎登录页），未再出现应用不存在类错误。

若凭据变更，填入 `src/config/zhihu.ts` 或设置环境变量即可。
未配置时点击登录会跳到 `/login-error` 并给出明确提示。

### 3. 用环境变量覆盖（推荐用于生产）

每个配置项都支持同名环境变量覆盖，优先级高于源码内置值：

```bash
ZHIHU_ACCESS_SECRET=xxx ZHIHU_OAUTH_APP_ID=yyy npm run start
```

> **实现要点**：配置通过 `getAccessSecret()` 等**函数在运行时读取** `process.env`。
> 如果写成模块顶层的 `process.env.X ?? '默认值'`，Next.js 会在 build 阶段把整个表达式
> **静态内联成默认值**，导致部署后设置环境变量完全失效。这是本项目已经踩过并修复的坑。

---

## 二、安全说明

- `src/config/zhihu.ts` 已加入 `.gitignore`，避免凭据被误提交到公开仓库。
- 凭据模块与 API 客户端均标记 `server-only`，**不会被打包进浏览器产物**。
- OAuth `access_token` 只存放在 **HttpOnly + 签名** 的 Cookie 中，
  浏览器 JS 无法读取，也不会出现在 URL 或前端日志里。
- `app_key` 与 token 交换全程在服务端完成。

---

## 三、目录结构

```
src/
├── config/zhihu.ts            # 凭据与接口地址（唯一需要改的配置文件）
├── lib/
│   ├── types.ts               # 开放平台响应类型定义
│   ├── zhihu.ts               # 开放平台 API 客户端（server-only）
│   ├── session.ts             # HttpOnly 签名 Cookie 会话 + state 校验
│   ├── state-store.ts         # state 服务端一次性消费（防重放）
│   ├── request.ts             # 请求 origin 解析（修复主机名漂移）
│   ├── similarity.ts          # 观点相似度：TF-IDF + 概念词典
│   ├── store.ts               # 领域模型与内存数据仓库
│   └── api.ts                 # 接口层鉴权与分页辅助
├── components/
│   ├── UserMenu.tsx           # 右上角头像与下拉菜单
│   └── ProfileTabs.tsx        # 关注 / 创作 两个 Tab + 加载更多
└── app/
    ├── layout.tsx             # 全局布局，读取会话渲染右上角
    ├── page.tsx               # 首页：热榜（SSR）
    ├── me/page.tsx            # 用户页
    ├── login-error/page.tsx   # 登录失败提示
    └── api/
        ├── auth/{login,callback,logout}/
        ├── hot/               # 热榜 JSON
        ├── me/{followees,contents}/   # 授权用户数据
        ├── opinions/          # 观点发表、可见性、匹配
        ├── requests/          # 交流请求与同意/拒绝
        └── threads/           # 对话与消息
```

---

## 四、接口对接说明

### 鉴权规则

所有开放平台请求都带：

- `Authorization: Bearer <access_secret>` —— 鉴权**调用方**
- `X-Request-Timestamp: <秒级时间戳>`
- `X-OAuth-Token: <oauth_access_token>` —— **仅**在代表已授权用户访问时携带

### 已对接接口

| 能力 | 接口 |
|---|---|
| 热榜 | `GET /api/v1/content/hot_list`（Limit 1~30） |
| 关注的人 | `GET /api/v1/user/followees`（Offset/Limit，Limit ≤ 50） |
| 创作内容 | `GET /api/v1/user/contents`（ContentType/SortField/SortOrder） |
| 授权页 | `GET https://openapi.zhihu.com/authorize` |
| 换取 token | `POST https://openapi.zhihu.com/access_token` |

### 协议注意点（已在代码中处理）

1. **回调参数名不一致**：授权回调实际返回 `authorization_code`，而 token 接口的表单字段叫
   `code`。代码同时接受 `authorization_code` 和 `code`。
2. **业务码 20000 表示成功**：`/access_token` 与 `/user` 返回的 `code: 20000` 是成功标志，
   不能当作错误；代码优先检查 `access_token` 是否存在。
3. **分页类型不对称**：请求参数 `Offset` 是 Int64，响应 `NextOffset` 却是 String。
   代码做严格整数解析，解析失败按「已到末页」处理，不静默截断。
4. **鉴权失败不降级**：用户接口返回 20001 时一律返回 401，由前端提示重新登录，
   绝不静默切换回 Access Secret 所属账号。

### state 校验（黑客松流程）

黑客松 OAuth 服务**支持 `state` 原样透传**，因此本项目实现了完整的登录 CSRF 防护：

1. 发起授权前用 `randomBytes(32)` 生成不可预测的 state，签名后绑定当前浏览器会话，有效期 10 分钟；
2. 授权 URL 携带该 state；
3. 回调到达后，**在交换 Token 之前**校验 state 一致性与有效期；
4. 校验通过后原子消费。

> **注意**：通用 OAuth 文档记录的「回调不返回 state」属于历史情况，**不适用于黑客松流程**。

**防重放的关键**：仅 `cookies().delete()` 不足以防重放——它只是通知浏览器丢弃 Cookie，
攻击者若同时持有 state 与对应 Cookie，仍可重复提交同一个授权码。因此
`src/lib/state-store.ts` 在**服务端**额外记录已消费的 state，做真正的一次性消费。
该实现使用进程内存，适用于常驻单进程部署；多实例或 Serverless 需替换为 Redis 等共享存储。

### 用户基础信息接口

`GET https://openapi.zhihu.com/user`，仅需 `Authorization: Bearer <OAuth access_token>`，
不需要 Access Secret、`X-OAuth-Token` 或时间戳。

字段：`uid`、`hash_id`、`fullname`、`headline`、`avatar_path` 等。

> **`uid` 精度**：`uid` 是 int64，可能超出 JavaScript 安全整数范围。代码在 JSON 解析
> 阶段就从原始文本无损提取并以字符串保存，**不能**先 `JSON.parse` 成 Number 再转字符串，
> 否则末位会被舍入。

### 主机名一致性

重定向统一使用 `src/lib/request.ts` 的 `resolveOrigin()`，从请求 Host 头解析 origin。
不能直接用 `request.nextUrl.origin`——它在某些运行模式下会被规范化成 `localhost`，
导致从 `127.0.0.1` 访问时重定向后主机名改变，浏览器不再回传 HttpOnly 会话 Cookie，
表现为「登录成功却仍未登录」。这是实测中发现并修复的问题。

## 五、已知限制

- **热榜额度**：开发期间真实接口曾持续返回 `Code 30001 rate limit exceeded`
  （账号级配额，用 `zhihu-cli` 直连同样如此）。页面会把该错误原样提示给用户。
- **npm audit**：`next` 已升级到 15.5.25（修复了 15.1.6 的 CVE-2025-66478）。
  剩余 `postcss` 传递依赖告警需升级到 next@16 大版本才能消除，属破坏性变更，未执行。
- **OAuth 凭据**：`app_id` / `app_key` 已填入赛事分配值并通过授权端点实测受理。
  尚未完成端到端真实账号授权，原因是回调地址仍指向本地，需部署到公网后配套登记。
- **state 存储**：一次性消费记录使用进程内存，多实例部署需替换为共享存储。
- **业务数据存储**：观点、请求、对话存于进程内存并预置 8 条种子观点，
  进程重启后新增数据丢失，多实例不共享。生产化需替换为 Postgres/Redis，
  `src/lib/store.ts` 的函数签名即接口边界。
- **匹配算法**：概念词典为人工维护的有限集合（9 组议题），未覆盖的同义表达
  仍依赖词面匹配。
- **对话实时性**：请求式刷新，未接入 WebSocket。
