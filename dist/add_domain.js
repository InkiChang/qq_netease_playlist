
(async () => {
  const acc = '593b7dfe753c49ea7e93a2510cf73474';
  const body = {
    hostname: 'playlist-parser.inkichang.kdns.fr',
    zone_id: 'c321e145d8e5f81e519fa07beea8d2c3',
    service: 'playlist-parser',
    environment: 'production'
  };
  const out = {};
  try {
    const r = await fetch('/api/v4/accounts/' + acc + '/workers/domains', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const d = await r.json();
    out.ret = { status: r.status, success: d.success, result: d.result, errors: d.errors };
  } catch (e) { out.ret = 'ERR ' + e.message; }
  // 再查一次列表确认
  try {
    const r = await fetch('/api/v4/accounts/' + acc + '/workers/domains', { credentials: 'include' });
    const d = await r.json();
    out.list = (d.result || []).map(x => ({ hostname: x.hostname, service: x.service, enabled: x.enabled }));
  } catch (e) { out.list = 'ERR ' + e.message; }
  return JSON.stringify(out, null, 1);
})()