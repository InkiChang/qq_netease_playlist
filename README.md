# qq_netease_playlist · QQ音乐 / 网易云 歌单解析 Worker

把 HiFi-DL 中「歌单分享链接 → 歌曲清单」的能力提取出来，封装为 **Cloudflare Workers** 项目：粘贴一个网易云 / QQ 音乐的歌单分享链接，即可得到统一格式的歌曲清单（JSON / CSV / TXT / M3U）。

- **零第三方依赖**：仅使用 Worker 运行时内置的 `fetch` / `URL` / `AbortController`
- **自带响应式 GUI**：iOS 风格浅色界面，PC 宽屏居中单列、手机单列自适应
- **可作纯 API 调用**：`GET /?url=...&format=json`

## ✨ 特性

| 输入 | 输出 |
|---|---|
| 网易云：`music.163.com/#/playlist?id=`、`y.music.163.com/m/playlist?id=`、`163cn.tv` 短链、客户端分享链接 | `json`（结构化） / `csv`（UTF-8 BOM，Excel 直开）/ `txt`（`歌名 - 歌手`）/ `m3u` |
| QQ 音乐：`y.qq.com/n/ryqq/playlist/<id>`、`i2.y.qq.com` 分享页等 | 同上，字段统一为 `{ name, artist, album, duration, source }` |

## 🚀 快速开始

### 方式 A：Dashboard 粘贴（最快，零命令行）

1. Cloudflare Dashboard → Workers & Pages → **创建 Worker**
2. 「编辑代码」→ 将 [dist/worker-single.js](dist/worker-single.js) 全部内容粘贴，替代默认代码
3. **部署**，然后访问你的 `*.workers.dev` 地址即可

### 方式 B：Wrangler CLI

```bash
npm install          # 安装 wrangler
npx wrangler login   # 登录
npx wrangler deploy  # 部署（配置见 wrangler.toml）
```

## 📡 API

### 解析歌单（GET，默认 JSON）

```bash
curl "https://<你的worker域名>/?url=https%3A%2F%2Fmusic.163.com%2F%23%2Fplaylist%3Fid%3D3778678"
```

```json
{
  "ok": true,
  "platform": "netease",
  "platformName": "网易云音乐",
  "title": "热歌榜",
  "count": 200,
  "url": "https://music.163.com/#/playlist?id=3778678",
  "songs": [
    { "name": "我不难过", "artist": "孙燕姿", "album": "未完成", "duration": 320.4, "source": "netease" }
  ]
}
```

### 指定输出格式

| format | 说明 |
|---|---|
| `json` | 结构化数据（默认） |
| `csv` | `歌名,歌手,专辑,时长(秒),音源`，UTF-8 BOM，Excel 直接打开 |
| `txt` | 每行 `歌名 - 歌手`，可导入 HiFi-DL / Apple Music |
| `m3u` | 播放列表，文件名 `歌手 - 歌名.mp3`，匹配 HiFi-DL 下载命名 |

```bash
curl -o 歌单.csv  "https://<你的worker域名>/?url=<歌单链接>&format=csv"
curl -o 歌单.m3u8 "https://<你的worker域名>/?url=<歌单链接>&format=m3u"
```

### POST（JSON body）

```bash
curl -X POST "https://<你的worker域名>/" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://music.163.com/#/playlist?id=3778678", "format": "csv"}'
```

### 错误

- 缺 `url` 参数 → `400 {"ok": false, "error": "缺少 url 参数。"}`
- 链接平台不支持 / 私有歌单 → `400` 或 `502`（带说明）

## 📦 项目结构

```
src/
  index.js            # Worker 入口：路由、CORS、format 输出
  online-playlist.js  # 解析核心（移植自 HiFi-DL，仅保留网易云/QQ）
  ui.html             # GUI 页面模板（内嵌）
  ui.js               # GUI 逻辑（内嵌构建进 ui.html）
scripts/
  build-single.mjs    # 生成 dist/worker-single.js（单文件、粘贴即部署）
  embed-ui.mjs        # 把 ui.html 转为 JS 字符串供 ui.js 引用
dist/
  worker-single.js    # 构建产物：单文件 Worker
  ui-demo.html        # GUI 离线预览（带模拟数据，浏览器直接打开）
test/
  test.mjs            # 解析模块：真实链接直测（网易云 + QQ）
  test-worker.mjs     # Worker 入口：format / 错误分支 / POST 集成测试
```

## 🧪 本地开发

```bash
node test/test.mjs             # 真实链接解析测试
node test/test-worker.mjs      # Worker 入口集成测试
node scripts/build-single.mjs  # 重新生成 dist/worker-single.js
```

## ⚠️ 注意事项

- 网易云大歌单（>200 首）分批拉取详情，超大歌单（>3000 首）可能触及 Worker 30s 外部等待上限
- 平台接口为公开非官方接口，可能随时调整失效；失效时优先检查 `src/online-playlist.js` 中的端点
- 本 Worker 无任何密钥配置，免费额度即可运行

## 📄 License

[MIT](LICENSE) © 2026 InkiChang

解析逻辑移植自 [HiFi-DL (SkmdysK/hifi-dl)](https://github.com/SkmdysK/hifi-dl) 的 `online-playlist.js` 模块，仅保留网易云 / QQ 音乐平台并去除 Node 专属依赖；**上游未声明开源协议**。本仓库代码（含改造部分）以 MIT 授权。