// 把 src/ui.html 转成 src/ui.js 模块（供 Worker 直接内嵌返回页面）
// 用法: node scripts/embed-ui.mjs
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readFile, writeFile } from 'fs/promises'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const html = await readFile(join(root, 'src', 'ui.html'), 'utf8')
const js = `// 自动生成（由 scripts/embed-ui.mjs 从 src/ui.html 转换，请勿手改）\nexport const UI_HTML = ${JSON.stringify(html)};\n`
const out = join(root, 'src', 'ui.js')
await writeFile(out, js, 'utf8')
console.log('生成:', out, (Buffer.byteLength(js, 'utf8') / 1024).toFixed(1) + ' KB')