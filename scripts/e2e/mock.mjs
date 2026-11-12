// 可编排的假 OpenAI 兼容服务。
// POST /__reset {script:[...], judge:[...]} 设置应答队列；GET /__log 取主模型请求，GET /__judge 取完成审查的裁判请求。
// script 的每项：{text} 回一段正文，{tool:{name,args}} / {tools:[...]} 回工具调用；队列空时回 "OK(default)"。
// 裁判请求（system 里有完成审查的说明）单独排队，judge 的每项是裁判回答的 JSON 对象；队列空时判完成。
import { createServer } from 'http'

const JUDGE_MARK = '你在审查一次交付'
const JUDGE_DEFAULT = { complete: true, confidence: 0.9, missing: [] }
let script = []
let judge = []
let log = []
let judgeLog = []

const send = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(obj))
}
const usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 }

/** 一次应答：stream 时按 SSE 分块发，否则回完整的 chat.completion。 */
function reply(res, body, step, n) {
  const calls = step.tools ?? (step.tool ? [step.tool] : [])
  const toolCalls = calls.map((t, i) => ({
    index: i,
    id: `call_${n}_${i}`,
    type: 'function',
    function: { name: t.name, arguments: JSON.stringify(t.args) },
  }))
  const finish = calls.length ? 'tool_calls' : 'stop'
  if (body.stream === false || body.stream === undefined) {
    return send(res, 200, {
      id: 'm',
      object: 'chat.completion',
      created: 0,
      model: 'mock-model',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: calls.length ? null : (step.text ?? ''),
            ...(calls.length ? { tool_calls: toolCalls.map(({ index: _i, ...c }) => c) } : {}),
          },
          finish_reason: finish,
        },
      ],
      usage,
    })
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const ch = (delta, finishReason) =>
    `data: ${JSON.stringify({ id: 'm', object: 'chat.completion.chunk', created: 0, model: 'mock-model', choices: [{ index: 0, delta, finish_reason: finishReason ?? null }] })}\n\n`
  res.write(ch({ role: 'assistant', content: '' }))
  if (calls.length) {
    toolCalls.forEach((c) => res.write(ch({ tool_calls: [c] })))
  } else {
    res.write(ch({ content: step.text ?? '' }))
  }
  res.write(ch({}, finish))
  res.write(
    `data: ${JSON.stringify({ id: 'm', object: 'chat.completion.chunk', created: 0, model: 'mock-model', choices: [], usage })}\n\n`,
  )
  res.end('data: [DONE]\n\n')
}

createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const url = req.url
    if (url === '/__reset') {
      const j = JSON.parse(body || '{}')
      script = j.script ?? []
      judge = j.judge ?? []
      log = []
      judgeLog = []
      return send(res, 200, { ok: true })
    }
    if (url === '/__log') return send(res, 200, log)
    if (url === '/__judge') return send(res, 200, judgeLog)
    if (req.method === 'GET' && url.endsWith('/models'))
      return send(res, 200, { object: 'list', data: [{ id: 'mock-model', object: 'model' }] })
    if (req.method === 'POST' && url.endsWith('/chat/completions')) {
      const b = JSON.parse(body)
      if (JSON.stringify(b.messages ?? []).includes(JUDGE_MARK)) {
        judgeLog.push({ n: judgeLog.length, body: b })
        const verdict = judge.shift() ?? JUDGE_DEFAULT
        return reply(res, b, { text: JSON.stringify(verdict) }, `j${judgeLog.length}`)
      }
      log.push({ n: log.length, body: b })
      return reply(res, b, script.shift() ?? { text: 'OK(default)' }, log.length)
    }
    res.writeHead(404)
    res.end()
  })
}).listen(Number(process.argv[2] ?? 18090), '127.0.0.1', () => console.log('mock up'))
