// 集成测试：本地模拟 Worker 入口（node test/test-worker.mjs）
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const root = dirname(fileURLToPath(import.meta.url))
const worker = (await import(pathToFileURL(join(root, '..', 'src', 'index.js')).href)).default
const NETEASE = encodeURIComponent('https://music.163.com/#/playlist?id=3778678')

for (const fmt of ['json', 'csv', 'txt', 'm3u']) {
  const req = new Request(`https://playlist-parser.example/?url=${NETEASE}&format=${fmt}`)
  const res = await worker.fetch(req)
  const body = await res.text()
  console.log(`[${fmt}] status=${res.status} len=${body.length} ct=${res.headers.get('content-type').split(';')[0]}`)
  if (fmt === 'json') {
    const d = JSON.parse(body)
    console.log(`   ok=${d.ok} title=${d.title} count=${d.count} first=${d.songs[0].name} - ${d.songs[0].artist}`)
  } else {
    console.log('   head:', body.split('\n').slice(0, 3).join(' | ').slice(0, 160))
  }
}

let res = await worker.fetch(new Request('https://playlist-parser.example/?format=json'))
console.log('[no-url]', res.status, (await res.text()).slice(0, 120))

res = await worker.fetch(new Request(`https://playlist-parser.example/?url=${encodeURIComponent('https://music.163.com/#/playlist?id=999999999')}&format=json`))
console.log('[bad-id]', res.status, (await res.text()).slice(0, 160))

res = await worker.fetch(new Request(`https://playlist-parser.example/?url=${NETEASE}&format=bad`))
console.log('[bad-fmt]', res.status, (await res.text()).slice(0, 120))

res = await worker.fetch(new Request('https://playlist-parser.example/', {
  method: 'POST',
  body: JSON.stringify({ url: 'https://y.qq.com/n/ryqq/playlist/3250610208', format: 'txt' }),
}))
console.log('[post-txt]', res.status, 'len=' + (await res.text()).length)