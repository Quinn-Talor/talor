import { exec } from 'child_process'
import { promisify } from 'util'
import { toolRegistry } from '../registry'
import type { ToolExecuteContext, ValidationResult, VerifyResult } from '../types'
import { DEFAULT_TOOL_TIMEOUT_MS } from '../types'
import { writeTmpOutput } from '../tool-tmp'

const execAsync = promisify(exec)

const DANGEROUS_SUBSTRINGS = [
  'rm -rf /',
  'mkfs',
  'dd if=',
  ':(){:|:&};:',
  '> /dev/sda',
  'chmod -R 777 /',
]

const DANGEROUS_PATTERNS: RegExp[] = [
  /\bcurl\b.*\|\s*(ba?sh|sh|zsh|fish)/i,
  /\bwget\b.*\|\s*(ba?sh|sh|zsh|fish)/i,
  /\b(env|printenv)\b/i,
  /~\/\.(ssh|aws|gnupg|config|netrc|docker|kube)\//i,
  /\/proc\/(self|[0-9]+)\/(environ|mem|maps)/i,
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

const STDOUT_THRESHOLD_BYTES = 10 * 1024  // 10KB — above this, save to file
const STDOUT_PREVIEW_BYTES = 2048

const bashTool = {
  name: 'bash',
  description: 'Execute a shell command in the workspace directory.',
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
    return { ok: true }
  },

  async verify(output: unknown, input: unknown, context: ToolExecuteContext): Promise<VerifyResult> {
    const raw = String(output ?? '')
    const { command } = input as { command: string }

    // unknown flag → append --help hint
    if (raw.includes('[exit: non-zero]') &&
        (raw.includes('unknown flag') || raw.includes('unknown command'))) {
      const base = command.trim().split(/\s+/).slice(0, 2).join(' ')
      return { ok: true, output: `${raw}\n[hint: run "${base} --help" to see available flags and commands]` }
    }

    // large output → save to file, return preview
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
    const { workspace, toolTimeoutMs = DEFAULT_TOOL_TIMEOUT_MS } = context
    const params = input as { command: string; description?: string }

    try {
      const result = await execAsync(params.command, {
        cwd: workspace,
        timeout: toolTimeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        shell: '/bin/bash',
      })

      const stdout = result.stdout?.trim() || ''
      const stderr = result.stderr?.trim() || ''
      const parts: string[] = []
      if (stdout) parts.push(stdout)
      if (stderr) parts.push(`[stderr]\n${stderr}`)
      return { output: parts.join('\n') || '(no output)' }
    } catch (err: any) {
      if (err.killed || err.signal === 'SIGTERM') {
        return { output: `Command timed out after ${toolTimeoutMs}ms` }
      }
      const errorOutput = err.stderr || err.message || String(err)
      return { output: `[exit: non-zero]\n${errorOutput.trim()}` }
    }
  },
}

export function registerBuiltinTools(): void {
  toolRegistry.register(bashTool)
}
