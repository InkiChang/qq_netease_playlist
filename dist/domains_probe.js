
(async () => {
  const acc = '593b7dfe753c49ea7e93a2510cf73474';
  const out = {};
  try {
    const r = await fetch('/api/v4/zones?name=inkichang.kdns.fr', { credentials: 'include' });
    const d = await r.json();
    out.zone = { status: r.status, result: d.result };
  } catch (e) { out.zone = 'ERR ' + e.message; }
  try {
    const r = await fetch('/api/v4/accounts/' + acc + '/workers/domains', { credentials: 'include' });
    const d = await r.json();
    out.domains = { status: r.status, result: d.result };
  } catch (e) { out.domains = 'ERR ' + e.message; }
  return JSON.stringify(out, null, 1);
})()