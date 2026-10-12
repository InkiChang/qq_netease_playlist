// ============================================
// 网易云 / QQ 音乐歌单分享链接解析 Worker（单文件版）
// 由 scripts/build-single.mjs 生成，可直接粘贴到
// Cloudflare Dashboard -> Workers -> 编辑代码
// 用法: GET /?url=<歌单链接>&format=json|csv|txt|m3u
// ============================================
'use strict'

/**
 * 在线歌单解析器（Cloudflare Workers 移植版）
 *
 * 移植自 HiFi-DL (lib/online-playlist.js)，仅保留网易云音乐 / QQ 音乐两个平台，
 * 移除 Node.js 专属依赖（crypto / Buffer），可在 CF Workers 运行时直接运行。
 *
 * 输出统一为 Apple 导出清单字段：{ name, artist, album, duration, source }
 */

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36',
  Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
}

const PLATFORM_NAMES = {
  netease: '网易云音乐',
  qq: 'QQ 音乐',
}

function asUrl(value) {
  const text = String(value || '').trim()
  if (!text) throw new Error('请输入歌单链接')
  let url
  try {
    url = new URL(text)
  } catch {
    throw new Error('歌单链接格式不正确')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('歌单链接必须使用 http 或 https')
  return url
}

function detectPlaylistPlatform(value) {
  const url = asUrl(value)
  const host = url.hostname.toLowerCase()
  if (host === '163cn.tv' || host.endsWith('.163cn.tv') || host === 'music.163.com' || host.endsWith('.music.163.com') || host === 'y.music.163.com') return 'netease'
  if (host === 'y.qq.com' || host.endsWith('.y.qq.com') || host === 'qqmusic.qq.com') return 'qq'
  throw new Error('暂不支持该平台的歌单链接（当前支持：网易云音乐、QQ 音乐）')
}

function htmlDecode(value) {
  return String(value || '')
    .replace(/&#(\d+);|&#x([0-9a-fA-F]+);/g, (_, dec, hex) => String.fromCodePoint(parseInt(dec || hex, dec ? 10 : 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function clean(value) {
  return htmlDecode(String(value == null ? '' : value))
    .replace(/\s+/g, ' ')
    .trim()
}

function numberOrNull(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function normalizeSong({ name, artist, album, duration, source }) {
  const song = {
    name: clean(name),
    artist: clean(artist),
    album: clean(album),
    duration: numberOrNull(duration),
  }
  if (source) song.source = source
  return song
}

function uniqueSongs(songs) {
  const seen = new Set()
  return songs.filter((song) => {
    if (!song.name) return false
    const key = `${song.name}\u0000${song.artist}\u0000${song.album}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function request(url, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeout || 20_000)
  try {
    const requestOptions = {
      redirect: 'follow',
      ...options,
      headers: { ...DEFAULT_HEADERS, ...(options.headers || {}) },
      signal: options.signal || controller.signal,
    }
    if (requestOptions.body && typeof requestOptions.body === 'object' && !(requestOptions.body instanceof ArrayBuffer) && !(requestOptions.body instanceof URLSearchParams)) {
      requestOptions.body = JSON.stringify(requestOptions.body)
      if (!Object.keys(requestOptions.headers).some((key) => key.toLowerCase() === 'content-type')) {
        requestOptions.headers['Content-Type'] = 'application/json'
      }
    }
    return await fetch(url, requestOptions)
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('请求超时')
    throw new Error(`网络请求失败: ${err.message}`)
  } finally {
    clearTimeout(timer)
  }
}

async function requestJson(url, options) {
  const response = await request(url, options)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  try {
    const text = await response.text()
    const trimmed = text.trim()
    // 剥掉 JSONP 包裹（腾讯接口偶尔返回 callback(...) 形式）
    const jsonText = trimmed
      .replace(/^(?:try\s*\{)?\s*[\w$.]+\s*\(/, '')
      .replace(/\);?\s*(?:\} catch[\s\S]*)?$/, '')
      .trim()
    return JSON.parse(jsonText)
  } catch {
    throw new Error('接口返回不是有效 JSON')
  }
}

async function expandUrl(url) {
  const response = await request(url, {})
  const finalUrl = response.url || url
  let body = ''
  try {
    body = await response.text()
  } catch (_) {}
  return { url: finalUrl, body }
}

/* ------------------------- 网易云音乐 ------------------------- */

function idFromNeteaseUrl(url, body = '') {
  const candidates = [url, url.replace(/#/, '&')]
  for (const value of candidates) {
    try {
      const parsed = new URL(value)
      const id = parsed.searchParams.get('id') || parsed.searchParams.get('playlistId')
      if (/^\d+$/.test(id || '')) return id
      const match = `${parsed.pathname}${parsed.hash}`.match(/(?:playlist|songlist)[^\d]*(\d{3,})/i)
      if (match) return match[1]
    } catch (_) {}
  }
  const match = String(body).match(/(?:playlist|songlist)[^\d]{0,30}(\d{3,})|[?&#]id=(\d{3,})/i)
  return match ? match[1] || match[2] : null
}

function normalizeNeteaseTrack(item) {
  const track = item && (item.simpleSong || item)
  if (!track) return null
  const artists = track.ar || track.artists || []
  const album = track.al || track.album || {}
  const rawDuration = Number(track.dt || track.duration || 0)
  return normalizeSong({
    name: track.name,
    artist: Array.isArray(artists) ? artists.map((a) => a.name).filter(Boolean).join('、') : artists.name || artists,
    album: album.name,
    duration: rawDuration / (rawDuration > 10_000 ? 1000 : 1),
    source: 'netease',
  })
}

async function parseNeteasePlaylist(url) {
  const expanded = await expandUrl(url)
  const id = idFromNeteaseUrl(expanded.url, expanded.body) || idFromNeteaseUrl(url)
  if (!id) throw new Error('无法从网易云链接中识别歌单 ID，请使用公开歌单链接')

  // /api/v6/playlist/detail 返回完整 trackIds；旧接口只返回预览
  const detailEndpoints = [
    `https://music.163.com/api/v6/playlist/detail?id=${id}`,
    `https://music.163.com/api/v3/playlist/detail?id=${id}&n=1000`,
    `https://music.163.com/api/playlist/detail?id=${id}&limit=1000`,
  ]
  let data
  let lastError
  for (const endpoint of detailEndpoints) {
    try {
      const candidate = await requestJson(endpoint, { headers: { Referer: 'https://music.163.com/' } })
      if (candidate.code === 200 && candidate.playlist) {
        data = candidate
        break
      }
      lastError = new Error(candidate.msg || '网易云歌单不可访问，可能未公开')
    } catch (err) {
      lastError = err
    }
  }
  if (!data) {
    const raw = String((lastError && lastError.message) || '')
    if (/no resource|404|not found|无此歌单/i.test(raw)) throw new Error('歌单不存在或未公开（请检查 ID 是否正确）')
    throw lastError || new Error('网易云歌单不可访问，可能未公开')
  }

  const title = clean(data.playlist.name)
  const trackIds = (data.playlist.trackIds || []).map((item) => String(item && (item.id || item))).filter((id) => /^\d+$/.test(id))
  let tracks = data.playlist.tracks || []
  if (trackIds.length > tracks.length) {
    tracks = []
    for (let offset = 0; offset < trackIds.length; offset += 200) {
      const ids = trackIds.slice(offset, offset + 200)
      const query = encodeURIComponent(JSON.stringify(ids.map((id) => ({ id: Number(id) }))))
      const songsData = await requestJson(`https://music.163.com/api/v3/song/detail?c=${query}`, {
        headers: { Referer: 'https://music.163.com/' },
      })
      if (songsData.code !== 200 || !Array.isArray(songsData.songs)) throw new Error(songsData.msg || '网易云歌曲详情读取失败')
      tracks.push(...songsData.songs)
    }
  }
  const songs = uniqueSongs(tracks.map(normalizeNeteaseTrack).filter(Boolean))
  if (!songs.length) throw new Error('网易云歌单中没有可解析的歌曲')
  return { platform: 'netease', platformName: PLATFORM_NAMES.netease, title, songs, url: expanded.url }
}

/* ------------------------- QQ 音乐 ------------------------- */

function idFromQqUrl(url, body = '') {
  const values = [url, body]
  for (const value of values) {
    try {
      const parsed = new URL(value)
      const id = parsed.searchParams.get('id') || parsed.searchParams.get('disstid') || parsed.searchParams.get('playlistId')
      if (/^\d+$/.test(id || '')) return id
      const match = `${parsed.pathname}${parsed.hash}`.match(/\/(?:playlist|playsquare)\/(\d+)/i)
      if (match) return match[1]
    } catch (_) {}
  }
  const match = String(body).match(/(?:disstid|playlistId|[?&#]id)\s*["'=:\s]+(\d{3,})|\/(?:playlist|playsquare)\/(\d{3,})/i)
  return match ? match[1] || match[2] : null
}

function normalizeQqTrack(item) {
  if (!item || typeof item !== 'object') return null
  const singers = item.singer || item.singers || item.artist || []
  const album = item.album || item.albuminfo || {}
  const rawDuration = Number(item.interval || item.duration || item.interval_ms || 0)
  return normalizeSong({
    name: item.title || item.songname || item.name,
    artist: Array.isArray(singers) ? singers.map((s) => s.name || s).filter(Boolean).join('、') : singers.name || singers,
    album: album.name || album.album_name || album.title,
    duration: item.interval_ms ? rawDuration / 1000 : rawDuration,
    source: 'qq',
  })
}

function findQqSongs(value) {
  const list = value && value.cdlist && value.cdlist[0] && value.cdlist[0].songlist
  return uniqueSongs((Array.isArray(list) ? list : []).map(normalizeQqTrack).filter(Boolean))
}

async function parseQqPlaylist(url) {
  const expanded = await expandUrl(url)
  const id = idFromQqUrl(expanded.url, expanded.body) || idFromQqUrl(url)
  if (!id) throw new Error('无法从 QQ 音乐链接中识别歌单 ID，请使用公开歌单链接')

  const endpoint = `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?${new URLSearchParams({
    type: '1',
    json: '1',
    utf8: '1',
    onlysong: '0',
    new_format: '1',
    disstid: id,
    loginUin: '0',
    hostUin: '0',
    format: 'json',
    inCharset: 'utf8',
    outCharset: 'utf-8',
    notice: '0',
    platform: 'yqq.json',
    needNewCode: '0',
  })}`
  const data = await requestJson(endpoint, {
    headers: {
      Origin: 'https://y.qq.com',
      Referer: `https://y.qq.com/n/ryqq/playlist/${id}`,
    },
  })
  if (Number(data.code) !== 0 || !data.cdlist || !data.cdlist[0]) {
    throw new Error(data.message || 'QQ 音乐歌单不可访问，可能未公开')
  }
  const cd = data.cdlist[0]
  const songs = findQqSongs(data)
  if (!songs.length) throw new Error('QQ 音乐歌单中没有可解析的歌曲')
  return { platform: 'qq', platformName: PLATFORM_NAMES.qq, title: clean(cd.dissname || cd.name), songs, url: expanded.url }
}

/* ------------------------- 统一入口 ------------------------- */

async function parseOnlinePlaylist(input, options = {}) {
  const platform = detectPlaylistPlatform(input)
  if (platform === 'netease') return parseNeteasePlaylist(input)
  if (platform === 'qq') return parseQqPlaylist(input)
  throw new Error('暂不支持该平台')
}



// 自动生成（由 scripts/embed-ui.mjs 从 src/ui.html 转换，请勿手改）
const UI_HTML = "<!DOCTYPE html>\r\n<html lang=\"zh-CN\">\r\n<head>\r\n<meta charset=\"UTF-8\">\r\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, viewport-fit=cover\">\r\n<meta name=\"theme-color\" content=\"#F2F2F7\">\r\n<title>歌单解析器</title>\r\n<style>\r\n* { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; }\r\nbody {\r\n  font-family: -apple-system, BlinkMacSystemFont, \"SF Pro Display\", \"SF Pro Text\", \"PingFang SC\", \"Segoe UI\", Roboto, \"Noto Sans SC\", sans-serif;\r\n  background: #F2F2F7; color: #000; line-height: 1.45;\r\n  padding: 24px 16px calc(32px + env(safe-area-inset-bottom));\r\n  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;\r\n}\r\n.wrap { max-width: 660px; margin: 0 auto; }\r\n\r\n/* ===== iOS 大标题 ===== */\r\nheader { padding: 12px 4px 20px; }\r\nheader h1 { font-size: 32px; font-weight: 700; letter-spacing: -0.3px; }\r\nheader p { margin-top: 6px; font-size: 14px; color: #8E8E93; }\r\n\r\n/* ===== 卡片 ===== */\r\n.card {\r\n  background: #FFF; border-radius: 16px; padding: 16px;\r\n  box-shadow: 0 1px 3px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.05);\r\n  margin-bottom: 16px;\r\n}\r\n.card + .card { margin-top: 0; }\r\n.card-title { font-size: 13px; font-weight: 600; color: #6D6D72; text-transform: none; margin-bottom: 10px; letter-spacing: .2px; }\r\n\r\n/* ===== 输入区 ===== */\r\n.field {\r\n  display: flex; align-items: center; gap: 8px;\r\n  background: #F2F2F7; border-radius: 12px; padding: 0 14px;\r\n  border: 1.5px solid transparent; transition: border-color .18s ease, background .18s ease;\r\n}\r\n.field:focus-within { background: #FFF; border-color: #007AFF; box-shadow: 0 0 0 3.5px rgba(0,122,255,.14); }\r\n.field .ic { font-size: 17px; opacity: .55; flex: none; }\r\n.field input {\r\n  flex: 1; border: 0; outline: 0; background: transparent;\r\n  font: inherit; font-size: 16px; padding: 13px 0; color: #000;\r\n}\r\n.field input::placeholder { color: #AEAEB4; }\r\n.field input::-webkit-scrollbar { display: none; }\r\n\r\n/* ===== 分段控件 ===== */\r\n.seg {\r\n  display: flex; background: #E9E9EB; border-radius: 9px; padding: 2px; margin-top: 12px;\r\n}\r\n.seg button {\r\n  flex: 1; border: 0; background: transparent; color: #000; font: inherit; font-size: 14px; font-weight: 500;\r\n  padding: 7px 0; border-radius: 7px; cursor: pointer; transition: all .18s ease;\r\n}\r\n.seg button.on { background: #FFF; color: #000; box-shadow: 0 1px 4px rgba(0,0,0,.12), 0 0 1px rgba(0,0,0,.08); font-weight: 600; }\r\n\r\n/* ===== 主按钮 ===== */\r\n.go {\r\n  display: block; width: 100%; margin-top: 14px; padding: 14px 0;\r\n  border: 0; border-radius: 12px; background: #007AFF; color: #FFF;\r\n  font: inherit; font-size: 17px; font-weight: 600; letter-spacing: .3px; cursor: pointer;\r\n  transition: transform .12s ease, opacity .18s ease, background .18s ease;\r\n}\r\n.go:active { transform: scale(.985); opacity: .85; }\r\n.go:disabled { opacity: .45; }\r\n.go.loading { background: #007AFF; opacity: .75; }\r\n\r\n/* ===== 错误条 ===== */\r\n.err {\r\n  display: none; margin-bottom: 16px; padding: 12px 14px;\r\n  background: #FFF2F0; border: 1px solid #FFD7D3; border-radius: 12px;\r\n  color: #D70015; font-size: 14px;\r\n}\r\n\r\n/* ===== 结果卡 ===== */\r\n.meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }\r\n.meta .t { font-size: 19px; font-weight: 700; letter-spacing: -0.2px; flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\r\n.pbadge { font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 999px; color: #FFF; flex: none; }\r\n.pbadge.netease { background: #E60026; }\r\n.pbadge.qq { background: #31C27C; }\r\n.st { font-size: 13px; color: #8E8E93; font-weight: 500; }\r\n.st.ok { color: #34C759; }\r\n\r\n.dl { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 14px; }\r\n.dl button {\r\n  padding: 10px 0; border: 1px solid rgba(0,122,255,.35); border-radius: 10px;\r\n  background: rgba(0,122,255,.08); color: #007AFF; font: inherit; font-size: 14px; font-weight: 600;\r\n  cursor: pointer; transition: background .15s ease, transform .12s ease;\r\n}\r\n.dl button:active { background: rgba(0,122,255,.18); transform: scale(.97); }\r\n\r\n/* ===== 搜索 ===== */\r\n.search {\r\n  width: 100%; margin-top: 14px; padding: 10px 14px 10px 38px;\r\n  background: #F2F2F7 url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='%238E8E93' stroke-width='2.4' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='M21 21l-4.3-4.3'/%3E%3C/svg%3E\") no-repeat 13px center;\r\n  border: 0; border-radius: 10px; font: inherit; font-size: 15px; color: #000; outline: 0;\r\n}\r\n.search:focus { background-color: #E9E9EB; }\r\n.search::placeholder { color: #AEAEB4; }\r\n\r\n/* ===== 歌曲列表 ===== */\r\n.tblbox { margin-top: 10px; max-height: 480px; overflow-y: auto; -webkit-overflow-scrolling: touch; border-radius: 10px; }\r\ntable { width: 100%; border-collapse: collapse; font-size: 15px; }\r\nth { position: sticky; top: 0; background: #FFF; text-align: left; font-size: 12px; font-weight: 600; color: #8E8E93; padding: 8px 0; border-bottom: 1px solid #E5E5EA; z-index: 1; }\r\ntd { padding: 11px 0; border-bottom: 1px solid #F0F0F4; vertical-align: middle; }\r\ntr:last-child td { border-bottom: 0; }\r\ntd.num { width: 34px; color: #C7C7CC; font-size: 13px; font-variant-numeric: tabular-nums; }\r\ntd.name { font-weight: 500; }\r\ntd.artist { color: #3C3C43; font-size: 14px; }\r\ntd.album { color: #8E8E93; font-size: 13px; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\r\ntd.dur { width: 56px; color: #8E8E93; font-size: 13px; text-align: right; font-variant-numeric: tabular-nums; }\r\n.empty { padding: 24px 0 !important; text-align: center; color: #AEAEB4; font-size: 14px; }\r\n\r\n/* ===== 页脚 ===== */\r\nfooter { text-align: center; color: #AEAEB4; font-size: 12px; margin-top: 26px; padding: 0 16px; }\r\n\r\n/* ===== 响应式：平板/窄窗（≥700px，仍单列加宽） ===== */\r\n@media (min-width: 700px) {\r\n  body { padding: 40px 24px calc(48px + env(safe-area-inset-bottom)); }\r\n  .wrap { max-width: 860px; }\r\n  header h1 { font-size: 34px; }\r\n  .dl button { font-size: 15px; }\r\n}\r\n\r\n/* ===== 桌面端（≥1000px）：居中单列加宽 ===== */\r\n@media (min-width: 1000px) {\r\n  body { padding: 48px 32px calc(56px + env(safe-area-inset-bottom)); }\r\n  .wrap { max-width: 980px; }\r\n  header { padding: 8px 4px 28px; text-align: center; }\r\n  header h1 { font-size: 40px; }\r\n  header p { font-size: 15px; }\r\n  .card { padding: 24px; margin-bottom: 20px; }\r\n  .card-title { font-size: 14px; margin-bottom: 12px; }\r\n  .field input { font-size: 16px; padding: 14px 0; }\r\n  .seg { margin-top: 14px; }\r\n  .seg button { padding: 9px 0; font-size: 15px; }\r\n  .go { padding: 15px 0; font-size: 17px; }\r\n  .meta .t { font-size: 22px; }\r\n  .dl { gap: 10px; margin-top: 16px; }\r\n  .dl button { padding: 12px 0; font-size: 15px; }\r\n  .search { padding: 12px 14px 12px 40px; font-size: 15px; }\r\n  .tblbox { max-height: 600px; margin-top: 12px; }\r\n  table { font-size: 15px; }\r\n  th { padding: 10px 0; }\r\n  td { padding: 13px 0; }\r\n  td.album { max-width: none; }\r\n  td.dur { font-size: 14px; }\r\n  footer { margin-top: 32px; font-size: 13px; }\r\n}\r\n</style>\r\n</head>\r\n<body>\r\n<div class=\"wrap\">\r\n<header>\r\n  <h1>歌单解析器</h1>\r\n  <p>粘贴网易云 / QQ 音乐歌单分享链接，生成可下载的歌曲清单</p>\r\n</header>\r\n\r\n<div class=\"card\">\r\n  <div class=\"card-title\">歌单链接</div>\r\n  <label class=\"field\">\r\n    <span class=\"ic\">🔗</span>\r\n    <input type=\"text\" id=\"url\" placeholder=\"https://… 支持 App 短链自动跳转\" autocomplete=\"off\" autocapitalize=\"off\" spellcheck=\"false\">\r\n  </label>\r\n  <div class=\"seg\" id=\"fmt\">\r\n    <button data-f=\"json\" class=\"on\">JSON</button>\r\n    <button data-f=\"csv\">CSV</button>\r\n    <button data-f=\"txt\">TXT</button>\r\n    <button data-f=\"m3u\">M3U8</button>\r\n  </div>\r\n  <button class=\"go\" id=\"go\">解析歌单</button>\r\n</div>\r\n\r\n<div class=\"err\" id=\"err\"></div>\r\n\r\n<div class=\"card\" id=\"result\" style=\"display:none\">\r\n  <div class=\"card-title\">解析结果</div>\r\n  <div class=\"meta\">\r\n    <span class=\"t\" id=\"title\">—</span>\r\n    <span class=\"pbadge\" id=\"pbadge\">—</span>\r\n    <span class=\"st\" id=\"st\">0 首</span>\r\n    <span class=\"st ok\" id=\"ms\"></span>\r\n  </div>\r\n  <div class=\"dl\">\r\n    <button id=\"dlcsv\">CSV</button>\r\n    <button id=\"dltxt\">TXT</button>\r\n    <button id=\"dlm3u\">M3U8</button>\r\n    <button id=\"dljson\">JSON</button>\r\n  </div>\r\n  <input type=\"text\" class=\"search\" id=\"search\" placeholder=\"搜索歌名 / 歌手 / 专辑\">\r\n  <div class=\"tblbox\">\r\n    <table><thead><tr><th></th><th>歌名</th><th>歌手</th><th>专辑</th><th style=\"width:56px;text-align:right\">时长</th></tr></thead>\r\n    <tbody id=\"tbody\"></tbody></table>\r\n  </div>\r\n</div>\r\n\r\n<footer>由 HiFi-DL 解析模块移植 · 网易云 / QQ 音乐公开歌单 · 接口可能随平台调整</footer>\r\n</div>\r\n<script>\r\nconst $ = (id) => document.getElementById(id);\r\nlet current = null;\r\nlet fmt = 'json';\r\n\r\ndocument.querySelectorAll('#fmt button').forEach((b) =>\r\n  b.onclick = () => {\r\n    document.querySelectorAll('#fmt button').forEach((x) => x.classList.remove('on'));\r\n    b.classList.add('on'); fmt = b.dataset.f;\r\n  });\r\n\r\nfunction showErr(msg) {\r\n  const e = $('err');\r\n  if (msg) { e.textContent = msg; e.style.display = 'block'; } else { e.style.display = 'none'; }\r\n}\r\nfunction fmtDur(s) {\r\n  if (!s) return '—';\r\n  const v = Math.round(Number(s)); if (!isFinite(v) || v <= 0) return '—';\r\n  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;\r\n}\r\n\r\nasync function parse() {\r\n  const link = $('url').value.trim();\r\n  if (!link) { showErr('请先粘贴歌单分享链接'); return; }\r\n  showErr(null);\r\n  const btn = $('go');\r\n  btn.classList.add('loading'); btn.disabled = true;\r\n  const t0 = performance.now();\r\n  try {\r\n    const res = await fetch(`?url=${encodeURIComponent(link)}&format=json`);\r\n    const data = await res.json();\r\n    if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));\r\n    current = { link, data };\r\n    render();\r\n    $('result').style.display = 'block';\r\n    $('ms').textContent = `${Math.round(performance.now() - t0)}ms`;\r\n    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });\r\n  } catch (err) {\r\n    $('result').style.display = 'none';\r\n    showErr(err.message || '解析失败，请检查网络或链接');\r\n  } finally {\r\n    btn.classList.remove('loading'); btn.disabled = false;\r\n  }\r\n}\r\n$('go').onclick = parse;\r\n$('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') parse(); });\r\n\r\nfunction render() {\r\n  const { link, data } = current;\r\n  $('title').textContent = data.title || '（未命名歌单）';\r\n  const pb = $('pbadge');\r\n  pb.textContent = data.platformName || data.platform || '';\r\n  pb.className = 'pbadge ' + (data.platform === 'netease' ? 'netease' : 'qq');\r\n  $('st').textContent = `${data.count || data.songs.length} 首`;\r\n  draw(data.songs, '');\r\n  ['dlcsv', 'dltxt', 'dlm3u', 'dljson'].forEach((id) => {\r\n    $(id).onclick = () => {\r\n      const f = id.replace('dl', '');\r\n      const a = document.createElement('a');\r\n      a.href = `?url=${encodeURIComponent(link)}&format=${f}`;\r\n      a.download = `${(data.title || '歌单').replace(/[\\\\/:*?\"<>|]/g, '_')}.${f === 'm3u' ? 'm3u8' : f}`;\r\n      document.body.appendChild(a); a.click(); a.remove();\r\n    };\r\n  });\r\n}\r\nfunction draw(list, kw) {\r\n  const tb = $('tbody');\r\n  const q = kw.trim().toLowerCase();\r\n  const rows = list.filter((s) => !q || [s.name, s.artist, s.album].join(' ').toLowerCase().includes(q));\r\n  if (!rows.length) { tb.innerHTML = '<tr><td colspan=\"5\" class=\"empty\">没有匹配的歌曲</td></tr>'; return; }\r\n  tb.innerHTML = rows.map((s, i) =>\r\n    `<tr><td>${i + 1}</td><td class=\"name\">${escapeHtml(s.name)}</td><td class=\"artist\">${escapeHtml(s.artist)}</td>` +\r\n    `<td class=\"album\">${escapeHtml(s.album || '')}</td><td class=\"dur\">${fmtDur(s.duration)}</td></tr>`).join('');\r\n}\r\nfunction escapeHtml(s) {\r\n  return String(s == null ? '' : s).replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]));\r\n}\r\n$('search').oninput = (e) => { if (current) draw(current.data.songs, e.target.value); };\r\n</script>\r\n</body>\r\n</html>\r\n";


'use strict'




const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  })
}

function fail(message, status = 400) {
  return jsonResponse({ ok: false, error: message }, status)
}

function escapeM3u(value) {
  return String(value || '').replace(/[\r\n]/g, ' ')
}

function formatPlaylist(result, format) {
  const { platform, platformName, title, songs, url } = result
  switch (format) {
    case 'csv': {
      const lines = ['\ufeff歌名,歌手,专辑,时长(秒),音源']
      for (const s of songs) {
        const cols = [s.name, s.artist, s.album, s.duration == null ? '' : s.duration, s.source || '']
        lines.push(cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      }
      return new Response(lines.join('\n'), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(title || 'playlist')}.csv`, ...CORS_HEADERS },
      })
    }
    case 'txt': {
      const lines = songs.map((s) => `${s.name} - ${s.artist || ''}`.trim().replace(/-\s*$/, ''))
      return new Response(lines.join('\n'), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(title || 'playlist')}.txt`, ...CORS_HEADERS },
      })
    }
    case 'm3u': {
      const lines = ['#EXTM3U', `#PLAYLIST:${title}`]
      for (const s of songs) {
        const file = `${s.artist || '未知歌手'} - ${s.name}.mp3`
        lines.push(`#EXTINF:${s.duration == null ? -1 : s.duration},${escapeM3u(s.artist || '未知歌手')} - ${escapeM3u(s.name)}`)
        lines.push(file)
      }
      return new Response(lines.join('\n'), {
        headers: { 'Content-Type': 'audio/x-mpegurl; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(title || 'playlist')}.m3u8`, ...CORS_HEADERS },
      })
    }
    default: {
      const body = {
        ok: true,
        platform,
        platformName,
        title,
        count: songs.length,
        url,
        songs,
      }
      return jsonResponse(body)
    }
  }
}

async function handle(request) {
  const url = new URL(request.url)

  // 跨域预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  let input = url.searchParams.get('url') || ''
  let format = (url.searchParams.get('format') || 'json').toLowerCase()

  // 浏览器直接访问（无 url 参数）→ 返回 GUI 页面；API 客户端 → 仍返回 JSON 错误
  if (!input && request.method === 'GET') {
    const accept = request.headers.get('accept') || ''
    if (accept.includes('text/html')) {
      return new Response(UI_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS },
      })
    }
  }

  if (request.method === 'POST') {
    try {
      const body = await request.json()
      if (body.url) input = body.url
      if (body.format) format = String(body.format).toLowerCase()
    } catch {
      return fail('POST 请求体必须是 JSON，例如 {"url": "...", "format": "csv"}')
    }
  }

  if (!input) {
    return fail('缺少 url 参数。用法: GET /?url=<歌单分享链接>&format=json|csv|txt|m3u')
  }
  if (!['json', 'csv', 'txt', 'm3u'].includes(format)) {
    return fail('format 必须是 json / csv / txt / m3u')
  }

  try {
    const result = await parseOnlinePlaylist(input)
    return formatPlaylist(result, format)
  } catch (err) {
    return fail(err.message || '解析失败', 502)
  }
}

addEventListener('fetch', (event) => {
  event.respondWith(handle(event.request))
})