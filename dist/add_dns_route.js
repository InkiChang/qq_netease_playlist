
(async () => {
  const acc = '593b7dfe753c49ea7e93a2510cf73474';
  const zone = 'c321e145d8e5f81e519fa07beea8d2c3';
  const out = {};
  // 1) 创建 DNS CNAME（proxied）
  try {
    const r = await fetch('/api/v4/zones/' + zone + '/dns_records', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'CNAME', name: 'playlist-parser',
        content: 'playlist-parser.inkicheng2012.workers.dev',
        proxied: true, ttl: 1, comment: 'playlist-parser worker custom domain'
      })
    });
    const d = await r.json();
    out.dns = { status: r.status, success: d.success, result: d.result && { id: d.result.id, name: d.result.name, content: d.result.content, proxied: d.result.proxied }, errors: d.errors };
  } catch (e) { out.dns = 'ERR ' + e.message; }
  // 2) 添加 worker route
  try {
    const r = await fetch('/api/v4/zones/' + zone + '/workers/routes', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: 'playlist-parser.inkichang.kdns.fr/*', script: 'playlist-parser' })
    });
    const d = await r.json();
    out.route = { status: r.status, success: d.success, result: d.result, errors: d.errors };
  } catch (e) { out.route = 'ERR ' + e.message; }
  return JSON.stringify(out, null, 1);
})()