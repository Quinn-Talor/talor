import { exec } from 'child_process'
import { promisify } from 'util'
import { join, isAbsolute, normalize } from 'path'
import { existsSync } from 'fs'
import { toolRegistry } from '../registry'
import type { ToolExecuteContext } from '../types'
import { DEFAULT_TOOL_TIMEOUT_MS } from '../types'

const execAsync = promisify(exec)

const DANGEROUS_PATTERNS = [
  'rm -rf /',
  'mkfs',
  'dd if=',
  ':(){:|:&};:',
  '> /dev/sda',
  'chmod -R 777 /',
  'wget.*|curl.*sh',
]

const SENSITIVE_PATHS = ['/etc/', '/root/', '/.ssh/', '/.aws/', '/usr/bin/', '/usr/sbin/', '/bin/', '/sbin/']

function isPatternDangerous(command: string): boolean {
  return DANGEROUS_PATTERNS.some(pattern => command.includes(pattern))
}

function isPathSensitive(filePath: string): boolean {
  return SENSITIVE_PATHS.some(sp => filePath.startsWith(sp))
}

function resolveInWorkspace(workspace: string, targetPath: string): string | null {
  if (!targetPath) return workspace
  
  const resolved = isAbsolute(targetPath) ? targetPath : join(workspace, targetPath)
  const normalized = normalize(resolved)
  
  if (!normalized.startsWith(workspace)) {
    return null
  }
  return normalized
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

    if (isPatternDangerous(params.command)) {
      return { output: 'Dangerous command not allowed.' }
    }

    const resolvedCommand = params.command
    
    if (resolvedCommand.includes('/etc/') || resolvedCommand.includes('/root/') || resolvedCommand.includes('/.ssh/')) {
      return { output: 'Cannot access sensitive system paths outside workspace.' }
    }

    try {
      const result = await execAsync(resolvedCommand, {
        cwd: workspace,
        timeout: toolTimeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        shell: '/bin/bash',
      })
      
      const output = result.stdout || '(no output)'
      return {
        output: output.trim(),
      }
    } catch (err: any) {
      if (err.killed) {
        return { output: `Command timed out after ${toolTimeoutMs}ms` }
      }
      
      const errorOutput = err.stderr || err.message || String(err)
      return {
        output: `Error: ${errorOutput.trim()}`,
      }
    }
  },
}

export function registerBuiltinTools(): void {
  toolRegistry.register(bashTool)
}
