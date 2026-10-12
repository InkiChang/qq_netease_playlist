// 生成单文件 Worker（供 Cloudflare Dashboard 直接粘贴部署）
// 用法: node scripts/build-single.mjs  ->  dist/worker-single.js
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readFile, writeFile, mkdir } from 'fs/promises'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const indexSrc = await readFile(join(root, 'src', 'index.js'), 'utf8')
const parserSrc = await readFile(join(root, 'src', 'online-playlist.js'), 'utf8')
const uiSrc = await readFile(join(root, 'src', 'ui.js'), 'utf8')

// 经典格式：移除 parser 模块尾部的 export 块
const parserBody = parserSrc.replace(/export\s*\{[\s\S]*?\}/, '')
if (parserBody === parserSrc) throw new Error('parserSrc 未找到 export 块')

const indexBody = indexSrc
  .replace(/^import .*$/gm, '')
  .replace(
    /export default\s*\{\s*fetch: handle,\s*\}/,
    `addEventListener('fetch', (event) => {
  event.respondWith(handle(event.request))
})`
  )

// ui.js: "export const UI_HTML = ..." -> "const UI_HTML = ..."
const uiConst = uiSrc.replace(/^export const /m, 'const ')
if (uiConst === uiSrc) throw new Error('ui.js 格式异常')

const banner = `// ============================================
// 网易云 / QQ 音乐歌单分享链接解析 Worker（单文件版）
// 由 scripts/build-single.mjs 生成，可直接粘贴到
// Cloudflare Dashboard -> Workers -> 编辑代码
// 用法: GET /?url=<歌单链接>&format=json|csv|txt|m3u
// ============================================
`

const single = banner + parserBody + '\n\n' + uiConst + '\n\n' + indexBody

await mkdir(join(root, 'dist'), { recursive: true })
const out = join(root, 'dist', 'worker-single.js')
await writeFile(out, single, 'utf8')
console.log('生成:', out, (Buffer.byteLength(single, 'utf8') / 1024).toFixed(1) + ' KB')