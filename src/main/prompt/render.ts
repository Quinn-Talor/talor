// src/main/prompt/render.ts — 基础设施层：极简 mustache-like 模板引擎
//
// 支持语法:
//   {{var.path}}                    变量替换 (undefined → 空字符串)
//   {{#if cond}}...{{/if}}          条件块 (truthy 渲染)
//   {{#each list}}...{{/each}}      迭代 (this / @index / @index_plus_1)
//   {{helperName arg}}              helper 函数调用 (单参数)
//
// 嵌套 if/each 支持。{{!-- ... --}} 注释会被剥离。
//
// 允许依赖: 仅 Node 标准库
// 禁止依赖: 任何外部 mustache/handlebars 库

export type Helper = (...args: unknown[]) => string

export interface RenderHelpers {
  [name: string]: Helper
}

export function render(
  template: string,
  ctx: Record<string, unknown>,
  helpers: RenderHelpers = {},
): string {
  // 1. 剥离注释
  const cleaned = template.replace(/\{\{!--[\s\S]*?--\}\}/g, '')

  // 2. 解析为 token 流
  const tokens = tokenize(cleaned)

  // 3. 构造 AST
  const { ast } = parse(tokens, 0, null)

  // 4. 渲染
  return renderNodes(ast, [ctx], helpers)
}

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'var'; expr: string }
  | { kind: 'if-open'; expr: string }
  | { kind: 'if-close' }
  | { kind: 'each-open'; expr: string }
  | { kind: 'each-close' }
  | { kind: 'helper'; name: string; args: string[] }

function tokenize(s: string): Token[] {
  const tokens: Token[] = []
  const re = /\{\{([\s\S]*?)\}\}/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) tokens.push({ kind: 'text', value: s.slice(last, m.index) })
    const inner = m[1].trim()
    if (inner.startsWith('#if ')) {
      tokens.push({ kind: 'if-open', expr: inner.slice(4).trim() })
    } else if (inner === '/if') {
      tokens.push({ kind: 'if-close' })
    } else if (inner.startsWith('#each ')) {
      tokens.push({ kind: 'each-open', expr: inner.slice(6).trim() })
    } else if (inner === '/each') {
      tokens.push({ kind: 'each-close' })
    } else if (/^\(.*\)\s*$/.test(inner)) {
      // {{(eq a b)}} not supported in this minimal version; skipped
      tokens.push({ kind: 'text', value: '' })
    } else if (inner.includes(' ')) {
      // helper invocation: helperName arg1 arg2
      const parts = inner.split(/\s+/)
      tokens.push({ kind: 'helper', name: parts[0], args: parts.slice(1) })
    } else {
      tokens.push({ kind: 'var', expr: inner })
    }
    last = re.lastIndex
  }
  if (last < s.length) tokens.push({ kind: 'text', value: s.slice(last) })
  return tokens
}

type Node =
  | { kind: 'text'; value: string }
  | { kind: 'var'; expr: string }
  | { kind: 'helper'; name: string; args: string[] }
  | { kind: 'if'; expr: string; body: Node[] }
  | { kind: 'each'; expr: string; body: Node[] }

function parse(
  tokens: Token[],
  start: number,
  terminator: 'if' | 'each' | null,
): { ast: Node[]; next: number } {
  const nodes: Node[] = []
  let i = start
  while (i < tokens.length) {
    const t = tokens[i]
    if (t.kind === 'text') {
      nodes.push({ kind: 'text', value: t.value })
      i++
    } else if (t.kind === 'var') {
      nodes.push({ kind: 'var', expr: t.expr })
      i++
    } else if (t.kind === 'helper') {
      nodes.push({ kind: 'helper', name: t.name, args: t.args })
      i++
    } else if (t.kind === 'if-open') {
      const inner = parse(tokens, i + 1, 'if')
      nodes.push({ kind: 'if', expr: t.expr, body: inner.ast })
      i = inner.next
    } else if (t.kind === 'each-open') {
      const inner = parse(tokens, i + 1, 'each')
      nodes.push({ kind: 'each', expr: t.expr, body: inner.ast })
      i = inner.next
    } else if (t.kind === 'if-close') {
      if (terminator !== 'if') throw new Error('unexpected {{/if}}')
      return { ast: nodes, next: i + 1 }
    } else if (t.kind === 'each-close') {
      if (terminator !== 'each') throw new Error('unexpected {{/each}}')
      return { ast: nodes, next: i + 1 }
    } else {
      i++
    }
  }
  if (terminator) throw new Error(`unclosed ${terminator} block`)
  return { ast: nodes, next: i }
}

function renderNodes(nodes: Node[], stack: unknown[], helpers: RenderHelpers): string {
  let out = ''
  for (const n of nodes) {
    if (n.kind === 'text') out += n.value
    else if (n.kind === 'var') out += formatValue(resolveExpr(n.expr, stack))
    else if (n.kind === 'helper') {
      const h = helpers[n.name]
      if (!h) {
        // unknown helper → empty
        continue
      }
      const args = n.args.map((a) => resolveLiteral(a, stack))
      out += formatValue(h(...args))
    } else if (n.kind === 'if') {
      const v = resolveExpr(n.expr, stack)
      if (truthy(v)) out += renderNodes(n.body, stack, helpers)
    } else if (n.kind === 'each') {
      const v = resolveExpr(n.expr, stack)
      if (Array.isArray(v)) {
        v.forEach((item, idx) => {
          const frame: Record<string, unknown> = {
            this: item,
            '@index': idx,
            '@index_plus_1': idx + 1,
            ...(typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {}),
          }
          out += renderNodes(n.body, [frame, ...stack], helpers)
        })
      }
    }
  }
  return out
}

function resolveExpr(expr: string, stack: unknown[]): unknown {
  // expr 是点路径，例: foo.bar.baz; this; @index
  if (expr === 'this') {
    const top = stack[0] as Record<string, unknown>
    return top.this !== undefined ? top.this : top
  }
  const parts = expr.split('.')
  for (const frame of stack) {
    if (typeof frame !== 'object' || frame === null) continue
    let v: unknown = frame
    let ok = true
    for (let i = 0; i < parts.length; i++) {
      if (v === null || v === undefined || typeof v !== 'object') {
        ok = false
        break
      }
      v = (v as Record<string, unknown>)[parts[i]]
    }
    if (ok && v !== undefined) return v
    // 第一段命中但后续路径不存在,也算命中(返回 undefined,不再回退)
    if (ok) return v
    if (parts[0] in (frame as Record<string, unknown>)) return v
  }
  return undefined
}

function resolveLiteral(arg: string, stack: unknown[]): unknown {
  if (/^".*"$/.test(arg) || /^'.*'$/.test(arg)) return arg.slice(1, -1)
  if (/^-?\d+(\.\d+)?$/.test(arg)) return Number(arg)
  if (arg === 'true') return true
  if (arg === 'false') return false
  if (arg === 'null') return null
  return resolveExpr(arg, stack)
}

function truthy(v: unknown): boolean {
  if (v === undefined || v === null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v.length > 0
  if (Array.isArray(v)) return v.length > 0
  return true
}

function formatValue(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}
