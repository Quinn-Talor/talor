// src/main/runtime/plugins.ts — 业务层：插件（Claude Code 格式）的加载、启用与产物映射（能力架构方案 §3.4）
//
// 插件放在 ~/.talor/plugins/<目录>/，只有配置 plugins.enabled 里列出的插件才经引擎 parsePlugin 解析；
// 没启用的只读 .claude-plugin/plugin.json 的 name（没有就用目录名）。单个插件解析失败只记下错误、
// 不影响其他插件。解析结果缓存在模块状态里，目录来源每轮同步读缓存；重载后通知监听方
// （目录、审批人的只读根、B2 的 hook）。
//
// 允许依赖: agent-engine、electron（app）、electron-log、store/config-store、runtime/*、@shared/types
// 禁止依赖: ipc/*、db/*、repos/*

import { readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import log from 'electron-log'
import {
  parsePlugin,
  type HookSpec,
  type McpServerSpec,
  type ParsedPlugin,
  type SecretRef,
} from 'agent-engine'
import type { BuiltinToolName } from '@shared/types/agent'
import type { PluginInfo } from '@shared/types/ipc'
import { ConfigStore } from '../store/config-store'
import type { CatalogContribution, McpCatalogEntry } from './catalog'
import { slugBase } from './mcp-spec'
import { envSecret } from './vault'

export interface LoadedPlugin {
  name: string
  dir: string
  parsed: ParsedPlugin
}

export interface PluginsState {
  plugins: LoadedPlugin[]
  errors: Array<{ dir: string; message: string }>
  available: Array<{ name: string; dir: string }>
}

export function pluginsDir(): string {
  return join(app.getPath('home'), '.talor', 'plugins')
}

/** 插件名：`.claude-plugin/plugin.json` 的非空 name，否则目录名。 */
async function pluginName(dir: string, fallback: string): Promise<string> {
  try {
    const manifest = JSON.parse(await readFile(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'))
    if (typeof manifest?.name === 'string' && manifest.name.trim()) return manifest.name
  } catch {
    // 没有 plugin.json 或不是 JSON：用目录名
  }
  return fallback
}

export async function loadPlugins(dir: string, enabled: string[]): Promise<PluginsState> {
  const state: PluginsState = { plugins: [], errors: [], available: [] }
  let names: string[]
  try {
    names = (await readdir(dir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
  } catch {
    return state
  }
  const seen = new Set<string>()
  for (const entry of names) {
    const pluginDir = join(dir, entry)
    const name = await pluginName(pluginDir, entry)
    const wanted = enabled.includes(name)
    if (seen.has(name)) {
      if (wanted) state.errors.push({ dir: pluginDir, message: `插件名重复：${name}` })
      continue
    }
    seen.add(name)
    state.available.push({ name, dir: pluginDir })
    if (!wanted) continue
    try {
      const parsed = await parsePlugin(pluginDir)
      state.plugins.push({ name, dir: pluginDir, parsed })
      log.info(
        `[plugins] loaded ${name} skills=${parsed.skills.length} agents=${parsed.agents.length} ` +
          `mcp=${parsed.mcpServers.length} hooks=${parsed.hooks.length} commands=${parsed.commands.length}`,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      state.errors.push({ dir: pluginDir, message })
      log.error(`[plugins] ${entry} 解析失败：${message}`)
    }
  }
  return state
}

let state: PluginsState = { plugins: [], errors: [], available: [] }
const listeners = new Set<() => void>()

function enabledPlugins(): string[] {
  return (
    (ConfigStore.getInstance().get('plugins') as { enabled?: string[] } | undefined)?.enabled ?? []
  )
}

export async function reloadPlugins(): Promise<void> {
  state = await loadPlugins(pluginsDir(), enabledPlugins())
  for (const fn of [...listeners]) {
    try {
      fn()
    } catch (err) {
      log.error('[plugins] 插件变化的监听出错', err)
    }
  }
}

export function currentPlugins(): LoadedPlugin[] {
  return state.plugins
}

export function onPluginsChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 插件 hook 超时的上限：引擎组件时限 30 秒，留 5 秒让 hook 自己的超时先到、原因能显示出来。 */
export const HOOK_TIMEOUT_CAP_MS = 25_000

/** 启用插件的全部 hook（按插件顺序、插件内保持解析顺序），超时截到上限。 */
export function pluginHooks(): HookSpec[] {
  return currentPlugins().flatMap((p) =>
    p.parsed.hooks.map((spec) => {
      if (spec.timeoutMs === undefined || spec.timeoutMs <= HOOK_TIMEOUT_CAP_MS) return spec
      log.warn(
        `[plugins] ${spec.source ?? p.name} 的 ${spec.event} hook 超时 ${spec.timeoutMs} 毫秒，按 ${HOOK_TIMEOUT_CAP_MS} 毫秒执行`,
      )
      return { ...spec, timeoutMs: HOOK_TIMEOUT_CAP_MS }
    }),
  )
}

/** 给界面的插件列表：每个插件目录一条，解析失败的带 error。 */
export function pluginInfos(): PluginInfo[] {
  const enabled = enabledPlugins()
  const zero = { skills: 0, agents: 0, mcpServers: 0, hooks: 0, commands: 0 }
  return state.available.map(({ name, dir }) => {
    const loaded = state.plugins.find((p) => p.dir === dir)
    const error = state.errors.find((e) => e.dir === dir)?.message
    const counts = loaded
      ? {
          skills: loaded.parsed.skills.length,
          agents: loaded.parsed.agents.length,
          mcpServers: loaded.parsed.mcpServers.length,
          hooks: loaded.parsed.hooks.length,
          commands: loaded.parsed.commands.length,
        }
      : zero
    return {
      name,
      dir,
      enabled: enabled.includes(name),
      loaded: loaded !== undefined,
      ...(error !== undefined ? { error } : {}),
      counts,
    }
  })
}

/** 启用插件的 skills 目录：审批人对它免询问只读。 */
export function pluginSkillRoots(): string[] {
  return [...new Set(currentPlugins().map((p) => join(p.dir, 'skills')))]
}

/** Claude Code 工具名（不区分大小写）→ Talor 内置工具名。 */
const CLAUDE_TOOLS: Readonly<Record<string, BuiltinToolName>> = {
  read: 'read',
  write: 'write',
  edit: 'edit',
  multiedit: 'edit',
  bash: 'bash',
  glob: 'glob',
  grep: 'grep',
  ls: 'ls',
}

/**
 * 插件 agent 的工具：映射为 Talor 内置工具名，不认识的丢弃并写 warn；声明了但全部丢弃时为 ['read']
 * （Talor 里空数组表示全部内置工具）；没有声明时为 undefined。
 */
export function pluginAgentTools(
  names: string[] | undefined,
  label: string,
): BuiltinToolName[] | undefined {
  if (names === undefined) return undefined
  const mapped = new Set<BuiltinToolName>()
  const dropped: string[] = []
  for (const name of new Set(names)) {
    const tool = CLAUDE_TOOLS[name.toLowerCase()]
    if (tool) mapped.add(tool)
    else dropped.push(name)
  }
  if (dropped.length > 0) log.warn(`[plugins] ${label} 不认识的工具：${dropped.join('、')}`)
  return mapped.size > 0 ? [...mapped] : ['read']
}

/** parseMcpConfig 的引用名是裸变量名，改为 `env:<VAR>`，模板里的 `${VAR}` 同步改。 */
function envRef(value: string | SecretRef): string | SecretRef {
  if (typeof value === 'string') return value
  const secret = envSecret(value.secret)
  return {
    secret,
    ...(value.template
      ? { template: value.template.replaceAll(`\${${value.secret}}`, `\${${secret}}`) }
      : {}),
  }
}

function envRecord(
  record: Record<string, string | SecretRef> | undefined,
): Record<string, string | SecretRef> | undefined {
  return record
    ? Object.fromEntries(Object.entries(record).map(([k, v]) => [k, envRef(v)]))
    : undefined
}

function pluginTransport(t: McpServerSpec['transport']): McpServerSpec['transport'] {
  if (t.kind === 'stdio') {
    const env = envRecord(t.env)
    return {
      ...t,
      ...(t.args ? { args: t.args.map(envRef) } : {}),
      ...(env ? { env } : {}),
    }
  }
  const headers = envRecord(t.headers)
  return { ...t, ...(headers ? { headers } : {}) }
}

/** 已加载插件 → 目录来源片段：skill、agent、命令名加 `<插件>:` 前缀，MCP 前缀为 `plugin_<插件>_<服务器>`。 */
export function pluginContribution(plugins: LoadedPlugin[]): CatalogContribution {
  return {
    skills: () =>
      plugins.flatMap((p) =>
        p.parsed.skills.map((pkg) => ({
          metadata: { name: `${p.name}:${pkg.name}`, description: pkg.description },
          content: pkg.content,
          filePath: join(pkg.dir ?? p.dir, 'SKILL.md'),
        })),
      ),
    agents: () =>
      plugins.flatMap((p) => {
        const skills = p.parsed.skills.map((pkg) => `${p.name}:${pkg.name}`)
        return p.parsed.agents.map((a) => {
          const tools = pluginAgentTools(a.tools, `${p.name}:${a.def.id}`)
          return {
            profile: {
              id: `${p.name}:${a.def.id}`,
              name: a.def.id,
              description: a.description,
              agentPrompt: a.def.instructions
                .flatMap((seg) =>
                  seg.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
                )
                .join('\n\n'),
              ...(tools !== undefined ? { tools } : {}),
              skills,
            },
            featureTools: [],
          }
        })
      }),
    mcpEntries: () =>
      plugins.flatMap((p) =>
        p.parsed.mcpServers.map((spec): McpCatalogEntry => {
          const slug = slugBase(`plugin_${p.name}_${spec.name}`)
          return {
            id: `plugin:${p.name}:${spec.name}`,
            name: `${p.name}:${spec.name}`,
            slug,
            spec: {
              name: slug,
              transport: pluginTransport(spec.transport),
              connectTimeoutMs: 60_000,
              callTimeoutMs: 300_000,
            },
          }
        }),
      ),
    commands: () =>
      plugins.flatMap((p) =>
        p.parsed.commands.map((c) => ({
          name: `${p.name}:${c.name}`,
          ...(c.description ? { description: c.description } : {}),
          content: c.content,
          source: `plugin:${p.name}`,
        })),
      ),
  }
}

/** 目录的插件来源：每次读取都按最新加载的插件计算。 */
export function pluginCatalogSource(): CatalogContribution {
  const latest = () => pluginContribution(currentPlugins())
  return {
    skills: () => latest().skills!(),
    agents: () => latest().agents!(),
    mcpEntries: () => latest().mcpEntries!(),
    commands: () => latest().commands!(),
  }
}
