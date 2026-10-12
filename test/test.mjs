// 本地测试：验证解析模块（node test/test.mjs）
// 用法: node test/test.mjs [歌单链接]  （不传参数则用内置公开歌单链接）

import { parseOnlinePlaylist, detectPlaylistPlatform } from '../src/online-playlist.js'

const DEFAULTS = [
  'https://music.163.com/#/playlist?id=3778678', // 网易云：云音乐热歌榜
  'https://y.qq.com/n/ryqq/playlist/3250610208', // QQ音乐：示例歌单
]

const links = process.argv.slice(2)
if (!links.length) links.push(...DEFAULTS)

for (const link of links) {
  console.log('='.repeat(70))
  console.log('链接:', link)
  try {
    const platform = detectPlaylistPlatform(link)
    console.log('平台:', platform)
    const start = Date.now()
    const result = await parseOnlinePlaylist(link)
    console.log(`√ 解析成功 (${Date.now() - start}ms)`)
    console.log('  歌单名:', result.title)
    console.log('  歌曲数:', result.songs.length)
    console.log('  前3首:', result.songs.slice(0, 3).map((s) => `${s.name} - ${s.artist} [${s.album || '-'}] ${s.duration || '?'}s`))
  } catch (err) {
    console.error('x 解析失败:', err.message)
  }
}