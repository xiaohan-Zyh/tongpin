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

**所有凭据一律通过环境变量注入，源码中不含任何明文机密。**
`src/config/zhihu.ts` 只负责读取，可安全提交到仓库。

| 环境变量 | 说明 | 是否必填 |
|---|---|---|
| `ZHIHU_ACCESS_SECRET` | 开放平台 Access Secret，鉴权**调用方** | 必填 |
| `ZHIHU_OAUTH_APP_ID` | OAuth 应用 ID，赛事页面分配 | 必填 |
| `ZHIHU_OAUTH_APP_KEY` | OAuth 应用密钥，赛事页面分配 | 必填 |
| `ZHIHU_OAUTH_REDIRECT_URI` | 回调地址，**必须与赛事页面登记值逐字符一致** | 必填 |
| `SESSION_SECRET` | 会话 Cookie 签名密钥，须为随机长字符串 | 必填 |
| `ZHIHU_OPEN_API_BASE` | 内容接口基址，仅本地联调时覆盖 | 选填 |
| `ZHIHU_OAUTH_BASE` | OAuth 接口基址，仅本地联调时覆盖 | 选填 |

### 1. 本地开发

复制模板并填入真实值（`.env.local` 已被 `.gitignore` 忽略，Next.js 会自动加载）：

```bash
cp .env.example .env.local
```

`SESSION_SECRET` 可用以下命令生成：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

凭据缺失时，页面会显示明确的配置引导，而不是白屏或报错。

### 2. 关于 OAuth 凭据

黑客松的 `app_id` / `app_key` 由**赛事页面分配**，不走通用邮件申请流程，
且区别于开放平台的 Access Secret。已实测确认授权端点正常受理本应用
（302 跳转到知乎登录页）。

> **实现要点**：配置通过 `getAccessSecret()` 等**函数在运行时读取** `process.env`。
> 如果写成模块顶层的 `process.env.X ?? '默认值'`，Next.js 会在 build 阶段把整个表达式
> **静态内联成默认值**，导致部署后设置环境变量完全失效。这是本项目已经踩过并修复的坑。

---

## 二、部署到 Vercel

### 1. 推送代码到 Git 仓库

仓库中**不含任何明文凭据**，可以安全推送到 GitHub：

```bash
git remote add origin <你的仓库地址>
git push -u origin master
```

### 2. 导入 Vercel 并配置环境变量

在 Vercel 导入该仓库（框架会自动识别为 Next.js），然后在
**Settings → Environment Variables** 中添加上表中的全部必填变量。

⚠️ `ZHIHU_OAUTH_REDIRECT_URI` 必须填公网 HTTPS 地址，例如：

```
https://<your-app>.vercel.app/api/auth/callback
```

该值必须与赛事页面登记的回调地址**逐字符一致**（协议、域名、端口、路径、尾斜杠），
否则换取 token 会被拒绝。由于域名在首次部署后才确定，建议顺序为：
先部署 → 拿到域名 → 回填环境变量并到赛事页面登记 → 重新部署生效。

### 3. 重新部署

环境变量修改后必须触发一次重新部署才会生效（Vercel 不会热更新已有部署）。

### 4. ⚠️ Serverless 架构下的已知行为（务必阅读）

本项目的业务数据（观点、交流请求、对话）与 OAuth state 一次性消费记录
均保存在**进程内存**中。Vercel 采用多实例 Serverless 架构，实例会被回收，
也不保证同一用户的连续请求落在同一实例上。因此线上会出现：

- **新发表的观点可能在下次刷新后消失**（请求落到了另一个实例）；
- **交流请求与对话可能时有时无**；
- **OAuth state 防重放降级**：重放拦截依赖内存记录，跨实例时可能拦不住。
  签名校验、有效期校验、Cookie 一次性删除仍然有效，登录 CSRF 防护未失效。

演示用的 8 条种子观点由代码在每个实例启动时写入，因此**匹配功能的演示效果
始终正常**：登录后发表观点即可看到相似度与匹配理由。

彻底解决需要把 `src/lib/store.ts` 与 `src/lib/state-store.ts` 替换为
Redis（如 Vercel KV）或 Postgres，两个文件的函数签名即为替换边界。

---

## 三、安全说明

- 源码与版本库中**不含任何明文凭据**，机密全部由环境变量注入。
- 凭据模块与 API 客户端均标记 `server-only`，**不会被打包进浏览器产物**。
  构建后已扫描 `.next/static` 确认无密钥字样。
- OAuth `access_token` 只存放在 **HttpOnly + 签名** 的 Cookie 中，
  浏览器 JS 无法读取，也不会出现在 URL 或前端日志里。
- `app_key` 与 token 交换全程在服务端完成。

---

## 四、目录结构

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

## 五、接口对接说明

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

## 六、已知限制

- **热榜额度**：开发期间真实接口曾持续返回 `Code 30001 rate limit exceeded`
  （账号级配额，用 `zhihu-cli` 直连同样如此）。页面会把该错误原样提示给用户。
- **npm audit**：`next` 已升级到 15.5.25（修复了 15.1.6 的 CVE-2025-66478）。
  剩余 `postcss` 传递依赖告警需升级到 next@16 大版本才能消除，属破坏性变更，未执行。
- **OAuth 凭据**：`app_id` / `app_key` 已通过环境变量注入并经授权端点实测受理。
  尚未完成端到端真实账号授权，需部署到公网、登记回调地址后才能跑通。
- **Serverless 内存限制**：state 一次性消费记录与业务数据（观点、请求、对话）
  均使用进程内存。部署到 Vercel 等多实例平台后，数据可能在实例间不一致或丢失，
  state 防重放会降级（签名与有效期校验仍有效）。详见「二、部署到 Vercel」第 4 节。
  替换边界为 `src/lib/store.ts` 与 `src/lib/state-store.ts` 的函数签名。
- **匹配算法**：概念词典为人工维护的有限集合（9 组议题），未覆盖的同义表达
  仍依赖词面匹配。
- **对话实时性**：请求式刷新，未接入 WebSocket。
