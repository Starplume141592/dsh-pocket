// 与内核 Web 服务的上游连接：用进程 launch token 换一次签名 cookie，
// 之后所有代理请求都带着它，并且把 Host/Origin 改写成内核自己的 origin。
import http from 'node:http';
import { URL } from 'node:url';

export function createUpstream({ origin, authenticatedUrl, log = () => {} }) {
  const base = new URL(origin);
  const host = base.host;
  let cookie = '';
  let refreshing = null;

  function rawGet(pathname, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: base.hostname,
          port: base.port || 80,
          method: 'GET',
          path: pathname,
          headers: { accept: 'text/html', ...headers },
        },
        (res) => {
          res.resume();
          resolve(res);
        },
      );
      req.on('error', reject);
      req.setTimeout(10_000, () => req.destroy(new Error('upstream timeout')));
      req.end();
    });
  }

  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const url = new URL(authenticatedUrl(`${base.origin}/`));
      const tokenPath = `${url.pathname}${url.search}`;
      const res = await rawGet(tokenPath);
      const setCookies = res.headers['set-cookie'] ?? [];
      const auth = setCookies.find((line) => line.startsWith('dsh-auth-'));
      if (!auth) {
        throw new Error(`无法从内核取得会话 cookie（HTTP ${res.statusCode}）`);
      }
      cookie = auth.split(';')[0];
      log(`upstream cookie 已更新（HTTP ${res.statusCode}）`);
      return cookie;
    })()
      .catch((error) => {
        log(`upstream cookie 获取失败：${error?.message ?? error}`);
        throw error;
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  return {
    origin: base.origin,
    host,
    get cookie() {
      return cookie;
    },
    refresh,
    ensureCookie() {
      return cookie ? Promise.resolve(cookie) : refresh();
    },
  };
}
