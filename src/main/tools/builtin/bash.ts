import { spawn } from 'child_process'
import * as os from 'os'
import { toolRegistry } from '../registry'
import type { ToolExecuteContext, ValidationResult, VerifyResult } from '../types'
import { DEFAULT_TOOL_TIMEOUT_MS } from '../types'
import { writeTmpOutput } from '../tool-tmp'

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

const SENSITIVE_PATH_PATTERNS = [
  '/etc/',
  '/root/',
  '/.ssh/',
  '/.aws/',
  '/usr/bin/',
  '/usr/sbin/',
]

function isCommandDangerous(command: string): boolean {
  if (DANGEROUS_SUBSTRINGS.some(s => command.includes(s))) return true
  if (DANGEROUS_PATTERNS.some(re => re.test(command))) return true
  if (SENSITIVE_PATH_PATTERNS.some(p => command.includes(p))) return true
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

const bashTool = {
  name: 'bash',
  description:
    'Execute an arbitrary shell command in the workspace. NOT for commands provided ' +
    'by listed skills (e.g. lark-cli, gh, jira) — activate the matching skill first ' +
    'via the `skill` tool to learn the correct subcommand and flag shapes.',
  riskLevel: 'HIGH' as const,
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      description: { type: 'string', description: 'Description of the command (optional)' },
    },
    required: ['command'],
  },

  validate(input: unknown, context: ToolExecuteContext): ValidationResult {
    const params = input as { command?: unknown }
    if (typeof params.command !== 'string' || !params.command.trim())
      return { ok: false, error: 'Missing required parameter: "command" must be a non-empty string.' }
    if (params.command.trim().length > 2000)
      return { ok: false, error: 'Command too long (max 2000 chars).' }
    if (!context.workspace)
      return { ok: false, error: 'Workspace not set. Please set workspace first.' }
    if (isCommandDangerous(params.command))
      return { ok: false, error: 'Dangerous command not allowed.' }
    const writeViolation = checkWritePaths(params.command, context.workspace)
    if (writeViolation)
      return { ok: false, error: writeViolation }
    return { ok: true }
  },

  async verify(output: unknown, input: unknown, context: ToolExecuteContext): Promise<VerifyResult> {
    const raw = String(output ?? '')
    const { command } = input as { command: string }

    if (raw.includes('[exit: non-zero]') &&
        (raw.includes('unknown flag') || raw.includes('unknown command'))) {
      const base = command.trim().split(/\s+/).slice(0, 2).join(' ')
      return { ok: true, output: `${raw}\n[hint: run "${base} --help" to see available flags and commands]` }
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
    const params = input as { command: string; description?: string }

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

      const hardKill = () => { try { child.kill('SIGKILL') } catch { /* already exited */ } }
      const terminate = (reason: 'timeout' | 'abort' | 'oversize') => {
        if (killed) return
        killed = reason
        try { child.kill('SIGTERM') } catch { /* ignore */ }
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
        if (killed === 'timeout') return finish({ output: `Command timed out after ${toolTimeoutMs}ms` })
        if (killed === 'abort') return finish({ output: `[aborted] Command was cancelled.` })
        if (killed === 'oversize') return finish({ output: `[exit: non-zero]\nCommand output exceeded ${MAX_BUFFER_BYTES} bytes and was terminated.` })
        if (code !== 0) {
          const errBody = stderr.trim() || `exit code ${code}`
          return finish({ output: `[exit: non-zero]\n${errBody}` })
        }
        const parts: string[] = []
        const out = stdout.trim()
        const err = stderr.trim()
        if (out) parts.push(out)
        if (err) parts.push(`[stderr]\n${err}`)
        finish({ output: parts.join('\n') || '(no output)' })
      })
    })
  },
}

export function registerBuiltinTools(): void {
  toolRegistry.register(bashTool)
}
