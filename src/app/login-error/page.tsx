export const dynamic = 'force-dynamic';

/** 登录失败提示页，把服务端的失败原因清晰展示给用户 */
export default async function LoginErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;

  return (
    <>
      <h1 className="page-title">登录未完成</h1>
      <div className="notice notice--error">
        {reason ?? '授权流程被中断，请重新尝试。'}
      </div>
      <div className="card">
        <div className="state">
          <a href="/api/auth/login">
            <button type="button" className="login-button">
              重新登录
            </button>
          </a>
          <p style={{ marginTop: 16 }}>
            或 <a href="/">返回热榜首页</a>
          </p>
        </div>
      </div>
    </>
  );
}
