import { isAccessSecretConfigured } from '@/config/zhihu';
import type { HotItem } from '@/lib/types';
import { fetchHotList } from '@/lib/zhihu';

// 热榜数据每 60 秒重新获取一次
export const revalidate = 60;

function HotRow({ item, rank }: { item: HotItem; rank: number }) {
  return (
    <li className="hot-item">
      <span className={`hot-item__rank${rank <= 3 ? ' hot-item__rank--top' : ''}`}>
        {rank}
      </span>
      <div className="hot-item__body">
        <a href={item.Url} target="_blank" rel="noreferrer">
          <h3 className="hot-item__title">{item.Title}</h3>
        </a>
        {item.Summary && <p className="hot-item__summary">{item.Summary}</p>}
        {/* 热榜是表达的起点：把议题带入发表框，而不只是读完就走 */}
        <a
          className="hot-item__write"
          href={`/tongpin?topic=${encodeURIComponent(item.Title.slice(0, 30))}`}
        >
          写下我的看法 →
        </a>
      </div>
      {item.ThumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="hot-item__thumb"
          src={item.ThumbnailUrl}
          alt=""
          loading="lazy"
        />
      )}
    </li>
  );
}

export default async function HomePage() {
  if (!isAccessSecretConfigured()) {
    return (
      <>
        <h1 className="page-title">知乎热榜</h1>
        <div className="notice notice--warn">
          尚未配置知乎开放平台 Access Secret。请设置环境变量{' '}
          <code>ZHIHU_ACCESS_SECRET</code>（本地写入 <code>.env.local</code>，
          线上在 Vercel 环境变量中配置），值可在{' '}
          <a
            href="https://developer.zhihu.com/profile"
            target="_blank"
            rel="noreferrer"
          >
            开放平台个人中心
          </a>{' '}
          获取。配置后重新部署或重启服务即可生效。
        </div>
      </>
    );
  }

  let items: HotItem[] = [];
  let error: string | null = null;

  try {
    const data = await fetchHotList(30);
    items = data.Items ?? [];
  } catch (err) {
    error = err instanceof Error ? err.message : '获取热榜失败';
  }

  return (
    <>
      <h1 className="page-title">知乎热榜</h1>
      <p className="page-subtitle">
        数据来自知乎开放平台 hot_list 接口，服务端渲染，每 60 秒刷新一次
      </p>

      {error && <div className="notice notice--error">{error}</div>}

      <div className="card">
        {items.length === 0 && !error ? (
          <div className="state">暂无热榜数据</div>
        ) : (
          <ol className="hot-list">
            {items.map((item, index) => (
              <HotRow key={item.Url} item={item} rank={index + 1} />
            ))}
          </ol>
        )}
      </div>
    </>
  );
}
