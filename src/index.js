'use strict'

import { parseOnlinePlaylist } from './online-playlist.js'
import { UI_HTML } from './ui.js'

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

export default {
  fetch: handle,
}