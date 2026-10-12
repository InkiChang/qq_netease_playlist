// 综合演示测试：解析 -> 各格式输出文件（node test/test-demo.mjs）
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { writeFileSync } from 'fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const worker = (await import(pathToFileURL(join(root, 'src', 'index.js')).href)).default
const outDir = join(root, 'dist')

const cases = [
  { label: '网易云热歌榜', url: 'https://music.163.com/#/playlist?id=3778678' },
  { label: 'QQ音乐周杰伦', url: 'https://y.qq.com/n/ryqq/playlist/3250610208' },
  { label: '无效链接(测错误分支)', url: 'https://music.163.com/#/playlist?id=99999999999' },
]

for (const c of cases) {
  const t0 = Date.now()
  const res = await worker.fetch(new Request(`https://demo/?url=${encodeURIComponent(c.url)}&format=json`))
  const data = await res.json()
  console.log(`\n===== ${c.label} | HTTP ${res.status} | ${Date.now() - t0}ms =====`)
  if (data.ok) {
    console.log(`歌单: ${data.title} (${data.platformName}) | 共 ${data.count} 首`)
    console.log('前 3 首:', data.songs.slice(0, 3).map(s => `${s.name} - ${s.artist} [${s.album || '-'}] ${s.duration}s`).join(' | '))
  } else {
    console.log('错误:', data.error)
  }
}

// 导出实际文件（网易云 CSV、QQ TXT、QQ M3U8）
async function save(fmt, url, fn) {
  const res = await worker.fetch(new Request(`https://demo/?url=${encodeURIComponent(url)}&format=${fmt}`))
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(join(outDir, fn), buf)
  console.log(`\n写出 ${fn}: ${buf.length} bytes (${res.status})`)
  // 打印文件头部几行
  const head = buf.toString('utf8').split(/\r?\n/).slice(0, 4).join('\n  ')
  console.log(`  ${head}`)
}

await save('csv', 'https://music.163.com/#/playlist?id=3778678', 'demo_netease.csv')
await save('txt', 'https://y.qq.com/n/ryqq/playlist/3250610208', 'demo_qq.txt')
await save('m3u', 'https://y.qq.com/n/ryqq/playlist/3250610208', 'demo_qq.m3u8')