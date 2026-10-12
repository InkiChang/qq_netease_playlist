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

export {
  detectPlaylistPlatform,
  parseOnlinePlaylist,
  parseNeteasePlaylist,
  parseQqPlaylist,
  normalizeNeteaseTrack,
  normalizeQqTrack,
  idFromNeteaseUrl,
  idFromQqUrl,
  findQqSongs,
  uniqueSongs,
}