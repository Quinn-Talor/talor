import { exec } from 'child_process'
import { promisify } from 'util'
import { toolRegistry } from '../registry'
import type { ToolExecuteContext } from '../types'
import { DEFAULT_TOOL_TIMEOUT_MS } from '../types'

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

  async execute(input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }> {
    const { workspace, toolTimeoutMs = DEFAULT_TOOL_TIMEOUT_MS } = context
    const params = input as { command: string; description?: string }

    if (!workspace) {
      return { output: 'Workspace not set. Please set workspace first.' }
    }

    if (typeof params.command !== 'string' || !params.command) {
      return { output: 'Command must be a non-empty string.' }
    }

    if (isCommandDangerous(params.command)) {
      return { output: 'Dangerous command not allowed.' }
    }

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
      if (stderr) parts.push(`[stderr]: ${stderr}`)
      const output = parts.join('\n') || '(no output)'
      return { output }
    } catch (err: any) {
      if (err.killed || err.signal === 'SIGTERM') {
        return { output: `Command timed out after ${toolTimeoutMs}ms` }
      }
      const errorOutput = err.stderr || err.message || String(err)
      return { output: `Error: ${errorOutput.trim()}` }
    }
  },
}

export function registerBuiltinTools(): void {
  toolRegistry.register(bashTool)
}
