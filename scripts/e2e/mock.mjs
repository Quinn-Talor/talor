// 可编排的假 OpenAI 兼容服务：POST /__reset {script:[...]} 设置应答队列，GET /__log 取请求记录
import { createServer } from 'http'
let script = []
let log = []
const send = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(obj))
}
createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const url = req.url
    if (url === '/__reset') {
      const j = JSON.parse(body || '{}')
      script = j.script ?? []
      log = []
      return send(res, 200, { ok: true })
    }
    if (url === '/__log') return send(res, 200, log)
    if (req.method === 'GET' && url.endsWith('/models'))
      return send(res, 200, { object: 'list', data: [{ id: 'mock-model', object: 'model' }] })
    if (req.method === 'POST' && url.endsWith('/chat/completions')) {
      const b = JSON.parse(body)
      log.push({ n: log.length, body: b })
      const step = script.shift() ?? { text: 'OK(default)' }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const ch = (delta, finish) =>
        `data: ${JSON.stringify({ id: 'm', object: 'chat.completion.chunk', created: 0, model: 'mock-model', choices: [{ index: 0, delta, finish_reason: finish ?? null }] })}\n\n`
      res.write(ch({ role: 'assistant', content: '' }))
      const calls = step.tools ?? (step.tool ? [step.tool] : [])
      if (calls.length) {
        calls.forEach((t, i) =>
          res.write(
            ch({
              tool_calls: [
                {
                  index: i,
                  id: `call_${log.length}_${i}`,
                  type: 'function',
                  function: { name: t.name, arguments: JSON.stringify(t.args) },
                },
              ],
            }),
          ),
        )
        res.write(ch({}, 'tool_calls'))
      } else {
        res.write(ch({ content: step.text ?? '' }))
        res.write(ch({}, 'stop'))
      }
      res.write(
        `data: ${JSON.stringify({ id: 'm', object: 'chat.completion.chunk', created: 0, model: 'mock-model', choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })}\n\n`,
      )
      return res.end('data: [DONE]\n\n')
    }
    res.writeHead(404)
    res.end()
  })
}).listen(Number(process.argv[2] ?? 18090), '127.0.0.1', () => console.log('mock up'))
