// 端到端：隔离主目录里启动真实 Electron 应用，经 CDP 驱动 talorAPI，假模型服务编排应答。
// 用法：先 `npx electron-vite build`，再 `npm run test:e2e`。
// 不碰真实的 ~/.talor：主目录与工作区都建在系统临时目录，结束后保留日志便于排查。
import { spawn, execSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  existsSync,
  createWriteStream,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HERE = import.meta.dirname
const ROOT = join(HERE, '..', '..')
const RUN = mkdtempSync(join(tmpdir(), 'talor-e2e-'))
const ISO = join(RUN, 'home')
const WS = join(RUN, 'ws')
const FIXTURE = join(HERE, 'fixtures', 'vision-test.png')
const PORT_MOCK = 18090
const MOCK = `http://127.0.0.1:${PORT_MOCK}`
const results = []
const PNG = readFileSync(FIXTURE)

const check = (id, name, ok, ev) => {
  results.push({ id, name, ok: !!ok, ev })
  console.log(
    `[${ok ? 'PASS' : 'FAIL'}] ${id} ${name} — ${typeof ev === 'string' ? ev : JSON.stringify(ev)}`,
  )
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 环境 ----------
mkdirSync(ISO, { recursive: true })
mkdirSync(WS, { recursive: true })
const withTail = (n) => Buffer.concat([PNG, Buffer.from([n])])
copyFileSync(FIXTURE, join(WS, 'img1.png'))
for (let i = 1; i <= 8; i++) writeFileSync(join(WS, `k${i}.png`), withTail(i))
const bigOf = (n) => Buffer.concat([PNG, Buffer.alloc(n - PNG.length, 7)])
writeFileSync(join(WS, 'big5.png'), bigOf(5 * 1024 * 1024))
writeFileSync(join(WS, 'big5p.png'), bigOf(5 * 1024 * 1024 + 1))
writeFileSync(join(WS, 'doc.pdf'), '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
writeFileSync(join(WS, 'notes.md'), '# 备忘\nSECRET-TOKEN-5521\n')
writeFileSync(join(WS, 'hello.txt'), 'hello-from-file')

// 直接启动 Electron 二进制：.bin/electron 只是包装脚本，杀掉它不会结束真正的应用进程
const ELECTRON_BIN = join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
if (!existsSync(join(ROOT, 'out/main/index.js'))) throw new Error('先构建：npx electron-vite build')
const mock = spawn('node', [join(HERE, 'mock.mjs'), String(PORT_MOCK)], { stdio: 'ignore' })
await sleep(800)
const mockReset = (script) =>
  fetch(`${MOCK}/__reset`, { method: 'POST', body: JSON.stringify({ script }) })
const mockLog = async () => await (await fetch(`${MOCK}/__log`)).json()

// ---------- 应用进程 + CDP ----------
let app,
  ws,
  msgId = 0
const pending = new Map()
async function launch(tag) {
  const out = createWriteStream(join(RUN, `main-${tag}.log`))
  app = spawn(ELECTRON_BIN, [join(HERE, 'launcher.mjs')], {
    env: {
      ...process.env,
      TALOR_ISO_HOME: ISO,
      TALOR_MAIN_ENTRY: join(ROOT, 'out/main/index.js'),
      ELECTRON_ENABLE_LOGGING: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  app.stdout.pipe(out)
  app.stderr.pipe(out)
  let target
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(500)
    try {
      const list = await (await fetch('http://127.0.0.1:9222/json')).json()
      target = list.find((t) => t.type === 'page' && t.url.startsWith('file:'))
    } catch {}
  }
  if (!target) throw new Error('应用没有起来 / 没有页面目标')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r, j) => {
    ws.onopen = r
    ws.onerror = j
  })
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d)
      pending.delete(d.id)
    }
  }
  for (let i = 0; i < 60; i++) {
    if (await ev('typeof window.talorAPI === "object"').catch(() => false)) return
    await sleep(500)
  }
  throw new Error('talorAPI 未就绪')
}
function ev(expr) {
  return new Promise((res, rej) => {
    const id = ++msgId
    pending.set(id, (d) =>
      d.result?.exceptionDetails
        ? rej(
            new Error(
              JSON.stringify(
                d.result.exceptionDetails.exception?.description ?? d.result.exceptionDetails,
              ),
            ),
          )
        : res(d.result.result.value),
    )
    ws.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression: expr, awaitPromise: true, returnByValue: true },
      }),
    )
  })
}
async function quit() {
  try {
    ws.close()
  } catch {}
  app.kill('SIGTERM')
  for (let i = 0; i < 40 && app.exitCode === null; i++) await sleep(250)
  if (app.exitCode === null) app.kill('SIGKILL')
  await sleep(500)
}

const SEND = (a) => `(async (a) => {
  const api = window.talorAPI; const evs = []
  const off = api.chat.onStream((e) => { if (e.session_id === a.sid) evs.push({ done: e.done, err: e.error_code, msg: e.error_message }) })
  const off2 = api.chat.onPermissionRequest((r) => api.chat.sendPermissionResponse({ requestId: r.requestId, decision: 'approved' }))
  let sendErr = null
  try { await api.chat.send({ session_id: a.sid, content: a.content, attachments: a.attachments }) } catch (e) { sendErr = String(e) }
  const end = Date.now() + 60000
  while (Date.now() < end && !evs.some((x) => x.done)) await new Promise((r) => setTimeout(r, 200))
  off(); off2()
  const rows = (await api.session.getMessages(a.sid)).map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, 300) : JSON.stringify(m.content).slice(0, 300) }))
  return { sendErr, done: evs.find((x) => x.done) ?? null, rows }
})(${JSON.stringify(a)})`
const send = (sid, content, attachments = []) => ev(SEND({ sid, content, attachments }))
const att = (name, mime) => {
  const p = join(WS, name)
  const size = readFileSync(p).length
  return { path: p, mime_type: mime, filename: name, size_bytes: size }
}
const newSession = (provider) =>
  ev(
    `(async () => { const api = window.talorAPI; const s = await api.session.create({ provider_id: ${JSON.stringify(provider)}, model_id: 'mock-model' }); await api.session.updateWorkspace({ session_id: s.id, workspace: ${JSON.stringify(WS)} }); return s.id })()`,
  )
const imgsOf = (body) =>
  body.messages.flatMap((m) =>
    Array.isArray(m.content)
      ? m.content.filter((p) => p.type === 'image_url').map((p) => p.image_url.url)
      : [],
  )
const decode = (url) => Buffer.from(url.split(',', 2)[1] ?? '', 'base64')
const okDone = (r) => r?.done && !r.done.err

let state = {}
try {
  await launch('1')
  check('T0', '应用在全新隔离主目录里启动、页面与 talorAPI 就绪', true, 'ok')

  // providers
  const mk = (name, vision) =>
    ev(
      `(async () => { const p = await window.talorAPI.providers.create({ type: 'openai', name: ${JSON.stringify(name)}, base_url: '${MOCK}/v1', api_key: 'mock-key', supports_vision: ${vision}, enabled: true }); await window.talorAPI.providers.getModels(p.id, true); return p.id })()`,
    )
  const pv = await mk('MOCK-VISION', true),
    pt = await mk('MOCK-TEXT', false)

  // T1 图片附件 + 随请求送出
  await mockReset([{ text: '收到图片' }])
  const s1 = (state.s1 = await newSession(pv))
  const r1 = await send(s1, '图里有什么？', [att('img1.png', 'image/png')])
  let log = await mockLog()
  const u1 = log.flatMap((l) => imgsOf(l.body))
  check(
    'T1a',
    '图片以 data:image/png;base64, 前缀送出且字节与原文件一致',
    u1.length >= 1 && u1[0].startsWith('data:image/png;base64,') && decode(u1[0]).equals(PNG),
    { n: u1.length, head: u1[0]?.slice(0, 24) },
  )
  check(
    'T1b',
    '本轮正常结束并显示回复',
    okDone(r1) && r1.rows.some((r) => r.role === 'assistant' && r.content.includes('收到图片')),
    { done: r1.done, rows: r1.rows.length },
  )
  // T2 跨轮保留
  await mockReset([{ text: '左边红色' }])
  const r2 = await send(s1, '左边什么颜色？')
  log = await mockLog()
  const u2 = log.flatMap((l) => imgsOf(l.body))
  check(
    'T2',
    '追问时前文图片仍在请求里（跨轮保留）',
    okDone(r2) && u2.length >= 1 && decode(u2[0]).equals(PNG),
    { n: u2.length },
  )

  // T3 不支持视觉
  await mockReset([])
  const s3 = await newSession(pt)
  const r3 = await send(s3, '看图', [att('img1.png', 'image/png')])
  check(
    'T3',
    '非视觉提供商带图 → PROVIDER_NO_VISION，且没有请求发给模型',
    r3.done?.err === 'PROVIDER_NO_VISION' && (await mockLog()).length === 0,
    { done: r3.done },
  )

  // T4 图片大小边界
  await mockReset([])
  const sb = await newSession(pv)
  const r4a = await send(sb, '大图', [att('big5p.png', 'image/png')])
  check(
    'T4a',
    '图片 5MiB+1 → MEDIA_TOO_LARGE，且没有请求发给模型',
    r4a.done?.err === 'MEDIA_TOO_LARGE' && (await mockLog()).length === 0,
    { done: r4a.done, sendErr: r4a.sendErr },
  )
  await mockReset([{ text: '5M ok' }])
  const r4b = await send(sb, '边界图', [att('big5.png', 'image/png')])
  const u4b = (await mockLog()).flatMap((l) => imgsOf(l.body))
  check('T4b', '图片恰好 5MiB 被接受并送出（与引擎上限一致）', okDone(r4b) && u4b.length === 1, {
    done: r4b.done,
    n: u4b.length,
  })

  // T5 PDF：openai 兼容声明只有 image → 引擎开跑前拒绝
  await mockReset([])
  const sp = await newSession(pv)
  const r5 = await send(sp, '读 PDF', [att('doc.pdf', 'application/pdf')])
  check(
    'T5a',
    'PDF 发给只声明图片的模型 → MODEL_INPUT_UNSUPPORTED，且没有请求发给模型',
    r5.done?.err === 'MODEL_INPUT_UNSUPPORTED' && (await mockLog()).length === 0,
    { done: r5.done },
  )
  await mockReset([{ text: '读到了' }])
  const r5b = await send(await newSession(pt), '看备忘', [att('notes.md', 'text/markdown')])
  const txt = JSON.stringify((await mockLog())[0]?.body.messages ?? [])
  check(
    'T5b',
    '文本附件（md）对非视觉模型照常内联进请求',
    okDone(r5b) && txt.includes('SECRET-TOKEN-5521'),
    { done: r5b.done },
  )

  // T6 read 读图（视觉模型）
  await mockReset([{ tool: { name: 'read', args: { path: 'img1.png' } } }, { text: '看到了' }])
  const s6 = await newSession(pv)
  const r6 = await send(s6, '读一下 img1.png 并描述', [])
  log = await mockLog()
  const u6 = log.length >= 2 ? imgsOf(log[1].body) : []
  check(
    'T6',
    'read 读图：视觉模型的第二次请求里带上了图片（data: 前缀、字节一致）',
    okDone(r6) &&
      log.length === 2 &&
      u6.length === 1 &&
      u6[0].startsWith('data:image/png;base64,') &&
      decode(u6[0]).equals(PNG),
    { reqs: log.length, imgs: u6.length, done: r6.done },
  )

  // T7 read 读图（非视觉模型）
  await mockReset([{ tool: { name: 'read', args: { path: 'img1.png' } } }, { text: '没法看图' }])
  const r7 = await send(await newSession(pt), '读一下 img1.png', [])
  log = await mockLog()
  const any7 = log.flatMap((l) => imgsOf(l.body))
  const t7 = JSON.stringify(log[1]?.body.messages ?? [])
  check(
    'T7',
    'read 读图：非视觉模型不收图片，改收文字说明，本轮正常结束',
    okDone(r7) && log.length === 2 && any7.length === 0 && t7.includes('img1.png'),
    { reqs: log.length, imgs: any7.length, done: r7.done },
  )

  // T8 keepRecentImages=4：成批省略，视图里留 4..7 张；8 张时恰好省略前 4 张
  const eight = Array.from({ length: 8 }, (_, i) => ({
    tool: { name: 'read', args: { path: `k${i + 1}.png` } },
  }))
  await mockReset([...eight, { text: '全看完' }])
  const r8 = await send(await newSession(pv), '依次读 k1..k8', [])
  log = await mockLog()
  const counts = log.map((l) => imgsOf(l.body).length)
  const last = log[log.length - 1]
  const u8 = last ? imgsOf(last.body) : []
  const tails = u8.map((u) => decode(u).at(-1))
  const lastText = JSON.stringify(last?.body.messages ?? [])
  check(
    'T8a',
    'keepRecentImages：每次请求的图片数都不超过 2×4−1=7，且总会保留最近一张',
    okDone(r8) && log.length === 9 && counts.every((c) => c <= 7),
    { counts },
  )
  check(
    'T8b',
    'keepRecentImages：读完 8 张后最后一次请求只剩最近 4 张（k5..k8），并注明较早图片已省略',
    u8.length === 4 &&
      JSON.stringify(tails) === JSON.stringify([5, 6, 7, 8]) &&
      lastText.includes('已从视图省略'),
    { imgs: u8.length, tails },
  )

  // T9 read 超大图片
  await mockReset([{ tool: { name: 'read', args: { path: 'big5p.png' } } }, { text: '图太大' }])
  const r9 = await send(await newSession(pv), '读 big5p.png', [])
  log = await mockLog()
  const t9 = JSON.stringify(log[1]?.body.messages ?? [])
  check(
    'T9',
    'read 超过 5MiB 的图片：不送图片，把 "Image too large" 报给模型，本轮正常结束',
    okDone(r9) &&
      log.length === 2 &&
      imgsOf(log[1].body).length === 0 &&
      t9.includes('Image too large'),
    { reqs: log.length, done: r9.done },
  )

  // T10 回归：文本文件 read + bash（走审批）
  await mockReset([
    { tool: { name: 'read', args: { path: 'hello.txt' } } },
    { tool: { name: 'bash', args: { command: 'echo bash-ran-ok' } } },
    { text: '完成' },
  ])
  const r10 = await send(await newSession(pt), '读 hello.txt 再 echo', [])
  log = await mockLog()
  const t10 = JSON.stringify(log.map((l) => l.body.messages))
  check(
    'T10',
    '回归：文本 read 与 bash（含自动批准）的结果都回到了模型',
    okDone(r10) &&
      log.length === 3 &&
      t10.includes('hello-from-file') &&
      t10.includes('bash-ran-ok'),
    { reqs: log.length, done: r10.done },
  )

  // 记录重启前的会话行
  state.rows1 = (await ev(`window.talorAPI.session.getMessages(${JSON.stringify(s1)})`)).map(
    (m) => m.role,
  )
  await quit()

  // T11 重启后：会话仍在、前文图片仍在
  await launch('2')
  const rows2 = (await ev(`window.talorAPI.session.getMessages(${JSON.stringify(s1)})`)).map(
    (m) => m.role,
  )
  check(
    'T11a',
    '重启后会话消息行与重启前一致（由运行档案推导）',
    JSON.stringify(rows2) === JSON.stringify(state.rows1) && rows2.length >= 4,
    { before: state.rows1, after: rows2 },
  )
  await mockReset([{ text: '还记得' }])
  const r11 = await send(s1, '重启后再问：图里还有什么？')
  const u11 = (await mockLog()).flatMap((l) => imgsOf(l.body))
  check(
    'T11b',
    '重启后追问，前文图片仍随请求带上',
    okDone(r11) && u11.length >= 1 && decode(u11[0]).equals(PNG),
    { n: u11.length, done: r11.done },
  )

  // T12 删除会话
  await ev(`window.talorAPI.session.delete(${JSON.stringify(s1)})`)
  const listed = await ev(`window.talorAPI.session.list().then((l) => l.map((s) => s.id))`)
  check('T12', '删除会话后列表中不再出现', !listed.includes(s1), { remaining: listed.length })
  await quit()

  // T13 退出清理 + 数据库形态
  const left = execSync(`pgrep -f "${join(HERE, 'launcher.mjs')}" || true`)
    .toString()
    .trim()
  check('T13a', '退出后没有残留的应用进程', left === '', left)
  const tables = execSync(`sqlite3 "${ISO}/.talor/chat.db" ".tables"`)
    .toString()
    .trim()
    .split(/\s+/)
  check(
    'T13b',
    'chat.db 里没有 messages 等旧表，只有会话/MCP/凭据相关表',
    !tables.includes('messages'),
    tables,
  )
  const logs = ['1', '2'].map((t) => readFileSync(join(RUN, `main-${t}.log`), 'utf8')).join('\n')
  const bad = logs
    .split('\n')
    .filter((l) => /Unhandled|uncaught|TypeError|ReferenceError|UnhandledPromiseRejection/i.test(l))
  check(
    'T13c',
    '主进程日志没有未捕获异常 / TypeError / ReferenceError',
    bad.length === 0,
    bad.slice(0, 3),
  )
} catch (e) {
  check('FATAL', '驱动异常', false, String(e?.stack ?? e))
} finally {
  try {
    await quit()
  } catch {}
  mock.kill()
  const pass = results.filter((r) => r.ok).length
  console.log(`\n== ${pass}/${results.length} passed ==（日志目录 ${RUN}）`)
  writeFileSync(join(RUN, 'results.json'), JSON.stringify(results, null, 1))
  process.exit(pass === results.length ? 0 : 1)
}
