import { spawn } from 'child_process'
import * as os from 'os'
import { z } from 'zod'
import { toolRegistry } from '../registry'
import type {
  ToolExecuteContext,
  ToolErrorEnvelope,
  ValidationResult,
  VerifyResult,
} from '../types'
import { DEFAULT_TOOL_TIMEOUT_MS } from '../types'
import { writeTmpOutput } from '../tool-tmp'

// exit=0 但 stderr 含失败关键字时视为 partial failure。很多工具(git/kubectl/rsync 等)
// 成功时也会往 stderr 写 warning,仅凭"stderr 非空"误判会太嘈杂;用关键字筛选
// 出**语义上明确指示失败**的输出。反之 exit=0 + 普通 stderr 加标注即可,模型看到
// "[stderr — informational only, exit=0]" 就不会当成失败。
const STDERR_FAILURE_HINTS =
  /\b(error|fatal|denied|refused|forbidden|unauthorized|not authorized|permission denied)\b/i

const DANGEROUS_SUBSTRINGS = [
  'rm -rf /',
  'mkfs',
  'dd if=',
  ':(){:|:&};:',
  '> /dev/sda',
  'chmod -R 777 /',
  'git push --force',
  'git push -f ',
  'git reset --hard',
  'history -c',
]

const DANGEROUS_PATTERNS: RegExp[] = [
  // 远程脚本直接执行 (curl/wget/fetch 管道给 shell/解释器)
  /\b(curl|wget|fetch)\b.*\|\s*(ba?sh|sh|zsh|fish|python|ruby|perl|node)/i,
  // 环境变量批量导出 (env / printenv 本身或作为管道源)
  /(^|\s)(env|printenv)(\s*$|\s+[^=]|\s*[|>])/i,
  // 家目录凭据
  /~\/\.(ssh|aws|gnupg|config|netrc|docker|kube)\//i,
  // proc 内存/环境泄露
  /\/proc\/(self|[0-9]+)\/(environ|mem|maps)/i,
  // 写入 shell rc (持久化后门入口)
  /(^|\s)(>>?|tee(\s+-a)?)\s+~\/\.(zshrc|bashrc|profile|bash_profile|zprofile|zshenv|bash_login)/i,
  // 绝对路径 rm -rf (排除临时目录)
  /\brm\s+-[a-z]*r[a-z]*f?\s+\/(?!tmp\/|var\/tmp\/|var\/folders\/)/i,
  // sudo
  /(^|\s)sudo(\s|$)/i,
]

const SENSITIVE_PATH_PATTERNS = ['/etc/', '/root/', '/.ssh/', '/.aws/', '/usr/bin/', '/usr/sbin/']

function isCommandDangerous(command: string): boolean {
  if (DANGEROUS_SUBSTRINGS.some((s) => command.includes(s))) return true
  if (DANGEROUS_PATTERNS.some((re) => re.test(command))) return true
  if (SENSITIVE_PATH_PATTERNS.some((p) => command.includes(p))) return true
  return false
}

const WRITE_REDIRECT_RE = /(?:^|[\s;&|])(?:>>?|tee(?:\s+-a)?)\s+(["']?)([^\s"'|&;<>]+)\1/g

/**
 * 拦截写入 workspace 外的重定向目标 (>, >>, tee)。
 * - /dev/null 和 /dev/stderr/stdout: 允许
 * - /tmp, /var/tmp, /var/folders(macOS): 允许(只能写临时文件不会泄漏敏感数据)
 * - 相对路径: 允许(默认解析到 workspace)
 * - 其他绝对路径或 ~: 必须位于 workspace 内
 */
function checkWritePaths(command: string, workspace: string): string | null {
  const matches = [...command.matchAll(WRITE_REDIRECT_RE)]
  for (const m of matches) {
    const target = m[2]
    if (target.startsWith('/dev/')) continue
    if (target.startsWith('/tmp/') || target === '/tmp') continue
    if (target.startsWith('/var/tmp/') || target === '/var/tmp') continue
    if (target.startsWith('/var/folders/')) continue
    if (!target.startsWith('/') && !target.startsWith('~')) continue
    const expanded = target.startsWith('~') ? target.replace(/^~/, os.homedir()) : target
    if (!expanded.startsWith(workspace + '/') && expanded !== workspace) {
      return `Write redirect "${target}" targets outside workspace "${workspace}".`
    }
  }
  return null
}

const STDOUT_THRESHOLD_BYTES = 10 * 1024
const STDOUT_PREVIEW_BYTES = 2048
const MAX_BUFFER_BYTES = 10 * 1024 * 1024

// 静态校验(不依赖 context):长度 + 危险命令黑名单。
// 需要 workspace 的规则(checkWritePaths 必须引用 context.workspace)
// 仍放在 tool.validate 里——Zod refine 拿不到 context。
//
// transform(s.trim()) 虽然更优雅但会让 toJSONSchema 崩溃(transform 不可序列化),
// 所以把 trim 逻辑放到 refine 里(校验 trim 后的内容),输出不做变换。
const BashInput = z.object({
  command: z
    .string()
    .describe('Shell command to execute')
    .refine(
      (s) => s.trim().length > 0,
      'Missing required parameter: "command" must be a non-empty string.',
    )
    .refine((s) => s.trim().length <= 2000, 'Command too long (max 2000 chars).')
    .refine((s) => !isCommandDangerous(s), 'Dangerous command not allowed.'),
  description: z.string().describe('Description of the command (optional)').optional(),
})
type BashInputT = z.infer<typeof BashInput>

const bashTool = {
  name: 'bash',
  description:
    'Execute an arbitrary shell command in the workspace. NOT for commands provided ' +
    'by listed skills (e.g. lark-cli, gh, jira) — activate the matching skill first ' +
    'via the `skill` tool to learn the correct subcommand and flag shapes.',
  riskLevel: 'HIGH' as const,
  zodSchema: BashInput,
  parameters: z.toJSONSchema(BashInput) as Record<string, unknown>,

  // Zod 已完成静态校验。这里只剩下需要 context 的业务规则。
  validate(input: unknown, context: ToolExecuteContext): ValidationResult {
    const params = input as BashInputT
    if (!context.workspace)
      return { ok: false, error: 'Workspace not set. Please set workspace first.' }
    const writeViolation = checkWritePaths(params.command, context.workspace)
    if (writeViolation) return { ok: false, error: writeViolation }
    return { ok: true }
  },

  async verify(
    output: unknown,
    input: unknown,
    context: ToolExecuteContext,
  ): Promise<VerifyResult> {
    // ToolErrorEnvelope 由 execute 直接产出(如 BASH_STDERR_FAILURE),verify 不应
    // 把它降级成字符串——原样透传,让 registry / stream-utils 按结构识别。
    if (
      output &&
      typeof output === 'object' &&
      (output as { __talor_error?: boolean }).__talor_error
    ) {
      return { ok: true, output }
    }
    const raw = String(output ?? '')
    const { command } = input as { command: string }

    if (
      raw.includes('[exit: non-zero]') &&
      (raw.includes('unknown flag') || raw.includes('unknown command'))
    ) {
      const base = command.trim().split(/\s+/).slice(0, 2).join(' ')
      return {
        ok: true,
        output: `${raw}\n[hint: run "${base} --help" to see available flags and commands]`,
      }
    }

    if (raw.length > STDOUT_THRESHOLD_BYTES && context.tmpDir) {
      const filePath = writeTmpOutput(context.sessionId, raw)
      const preview = raw.slice(0, STDOUT_PREVIEW_BYTES)
      return {
        ok: true,
        output:
          `[partial preview: first ${STDOUT_PREVIEW_BYTES} of ${raw.length} bytes]\n${preview}\n\n` +
          `[Full output saved to: ${filePath}]\n` +
          `[Use read tool to load the full content or specific sections]`,
      }
    }

    return { ok: true, output: raw }
  },

  async execute(input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }> {
    const { workspace, toolTimeoutMs = DEFAULT_TOOL_TIMEOUT_MS, abortSignal } = context
    const params = input as BashInputT

    return new Promise((resolve) => {
      const child = spawn('/bin/bash', ['-c', params.command], {
        cwd: workspace,
        env: process.env,
      })

      let stdout = ''
      let stderr = ''
      let stdoutBytes = 0
      let stderrBytes = 0
      let killed: 'timeout' | 'abort' | 'oversize' | null = null
      let settled = false

      const hardKill = () => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* already exited */
        }
      }
      const terminate = (reason: 'timeout' | 'abort' | 'oversize') => {
        if (killed) return
        killed = reason
        try {
          child.kill('SIGTERM')
        } catch {
          /* ignore */
        }
        setTimeout(hardKill, 2000).unref()
      }

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length
        if (stdoutBytes > MAX_BUFFER_BYTES) {
          terminate('oversize')
          return
        }
        stdout += chunk.toString('utf8')
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length
        if (stderrBytes > MAX_BUFFER_BYTES) return
        stderr += chunk.toString('utf8')
      })

      const timer = setTimeout(() => terminate('timeout'), toolTimeoutMs)
      const onAbort = () => terminate('abort')
      abortSignal?.addEventListener('abort', onAbort, { once: true })
      if (abortSignal?.aborted) terminate('abort')

      const finish = (payload: { output: unknown }) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        abortSignal?.removeEventListener('abort', onAbort)
        resolve(payload)
      }

      child.on('error', (err) => {
        finish({ output: `[exit: non-zero]\nFailed to spawn: ${err.message}` })
      })

      child.on('close', (code) => {
        if (killed === 'timeout')
          return finish({ output: `Command timed out after ${toolTimeoutMs}ms` })
        if (killed === 'abort') return finish({ output: `[aborted] Command was cancelled.` })
        if (killed === 'oversize')
          return finish({
            output: `[exit: non-zero]\nCommand output exceeded ${MAX_BUFFER_BYTES} bytes and was terminated.`,
          })
        if (code !== 0) {
          // Principle 3(逐字报告失败):非零退出要把命令实际输出原样带回。只取 stderr
          // 会丢两类常见情形 —— (1) CLI 把错误打到 stdout;(2) 模型用 `2>&1` 把 stderr
          // 并进 stdout(此时 stderr 捕获为空)。两种都会让模型只看到 "exit code N" 而
          // 无从诊断,盲目重试直至 failure-streak 收尾。合并 stdout+stderr 即可。
          const out = stdout.trim()
          const err = stderr.trim()
          const parts: string[] = []
          if (out) parts.push(out)
          if (err) parts.push(err)
          const errBody = parts.join('\n') || `exit code ${code}`
          return finish({ output: `[exit: non-zero]\n${errBody}` })
        }
        const out = stdout.trim()
        const err = stderr.trim()

        // exit=0 但 stderr 包含失败关键字 → 语义上是失败,改用错误信封。
        // 模型原本可能把 stderr 里的 "error: ..." 当成失败、或把它当噪音忽略;
        // 让代码做明确分类,模型就不用猜。
        if (err && STDERR_FAILURE_HINTS.test(err)) {
          const envelope: ToolErrorEnvelope = {
            __talor_error: true,
            code: 'BASH_STDERR_FAILURE',
            message: 'Command exited 0 but stderr reported failure-like output.',
            hint: out ? `stdout:\n${out}\n\nstderr:\n${err}` : `stderr:\n${err}`,
          }
          return finish({ output: envelope })
        }

        const parts: string[] = []
        if (out) parts.push(out)
        if (err) parts.push(`[stderr — informational only, exit=0]\n${err}`)
        finish({ output: parts.join('\n') || '(no output)' })
      })
    })
  },
}

export function registerBuiltinTools(): void {
  toolRegistry.register(bashTool)
}
