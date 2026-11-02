// src/main/runtime/dispatch.ts — 业务层：chat:send 的逐轮分派（能力架构方案 §4、§3.8）
//
// 运行时模式三档：off 只走旧路径；force 只走引擎；auto 在这一轮 agent 的能力都在引擎支持的种类里、
// 且运行时可用时走引擎，否则这一轮走旧路径（写 info 日志）。旧配置值 legacy 视为 off，engine 视为 force。
// auto 走引擎时，引擎用分派时算出的同一个目录快照；以插件命令开头的消息在 auto 下直接走引擎（B1）。
// 有启用插件的 hook 时（B2）：auto 一律走引擎（旧路径不执行 hook，退回去会绕过 hook 的限制），运行时
// 不可用由 sendTurn 经 onDone 报错；off 照旧走旧路径并写 warn；force 不变。
//
// 允许依赖: agent-engine（类型）、chat/orchestrator、chat/types（类型）、store/config-store、runtime/*
// 禁止依赖: ipc/*、db/*

import log from 'electron-log'
import { sendChat } from '../chat/orchestrator'
import type { ChatCallbacks, ChatPorts, ChatSendParams } from '../chat/types'
import { ConfigStore } from '../store/config-store'
import {
  currentCatalog,
  expandCommand,
  type AgentCapabilities,
  type CatalogSnapshot,
} from './catalog'
import type { HookSpec } from 'agent-engine'
import { getRuntime, type Runtime } from './engine'
import { pluginHooks } from './plugins'
import { profileForSession, sendTurn } from './turn'

export type RuntimeMode = 'off' | 'auto' | 'force'

/** 引擎路径支持的能力种类（能力集合的数组键）。 */
export const ENGINE_KINDS: readonly string[] = [
  'builtins',
  'mcpServers',
  'skills',
  'delegates',
  'featureTools',
]

export function runtimeMode(): RuntimeMode {
  const v = ConfigStore.getInstance().get('runtime') as string | undefined
  if (v === 'auto') return 'auto'
  if (v === 'force' || v === 'engine') return 'force'
  return 'off'
}

/** 能力覆盖：除 missing 外每个非空数组键都在 supported 里；不认识的种类视为不覆盖。 */
export function coverageOf(
  caps: AgentCapabilities,
  supported: readonly string[] = ENGINE_KINDS,
): { complete: boolean; missing: string[] } {
  const missing = Object.entries(caps)
    .filter(([key, value]) => key !== 'missing' && Array.isArray(value) && value.length > 0)
    .map(([key]) => key)
    .filter((key) => !supported.includes(key))
  return { complete: missing.length === 0, missing }
}

export async function dispatchTurn(
  params: ChatSendParams,
  callbacks: ChatCallbacks,
  ports: ChatPorts,
  deps: {
    mode?: () => RuntimeMode
    legacy?: typeof sendChat
    engine?: typeof sendTurn
    runtime?: () => Runtime
    catalog?: () => CatalogSnapshot
    pluginHooks?: () => HookSpec[]
  } = {},
): Promise<{ messageId: string }> {
  const mode = (deps.mode ?? runtimeMode)()
  const legacy = deps.legacy ?? sendChat
  const engine = deps.engine ?? sendTurn
  const runtimeDeps = deps.runtime ? { runtime: deps.runtime } : {}
  const hooks = mode === 'force' ? false : (deps.pluginHooks ?? pluginHooks)().length > 0
  if (mode === 'off') {
    if (hooks) log.warn(`[dispatch] runtime=off，插件 hook 不生效 session=${params.sessionId}`)
    return legacy(params, callbacks, ports)
  }
  if (mode === 'force') return engine(params, callbacks, ports, runtimeDeps)
  if (hooks) {
    // 不判覆盖、不探测运行时：运行时或目录不可用由 sendTurn 经 onDone 报错
    let hooked: CatalogSnapshot
    try {
      hooked = (deps.catalog ?? currentCatalog)()
    } catch {
      return engine(params, callbacks, ports, runtimeDeps)
    }
    return engine(params, callbacks, ports, { ...runtimeDeps, catalog: () => hooked })
  }

  const fallBack = (reason: string) => {
    log.info(`[dispatch] auto → legacy session=${params.sessionId} reason=${reason}`)
    return legacy(params, callbacks, ports)
  }
  let snapshot: CatalogSnapshot
  try {
    snapshot = (deps.catalog ?? currentCatalog)()
  } catch (err) {
    return fallBack(err instanceof Error ? err.message : String(err))
  }
  // 插件命令只在引擎路径展开：不再判定覆盖与运行时，运行时不可用由 sendTurn 经 onDone 报错
  if (expandCommand(params.content.trim(), snapshot.commands) !== undefined) {
    return engine(params, callbacks, ports, { ...runtimeDeps, catalog: () => snapshot })
  }
  try {
    const coverage = coverageOf(
      snapshot.select(profileForSession(params.sessionId, ports.agentManager)),
    )
    if (!coverage.complete) return fallBack(`coverage missing ${coverage.missing.join(',')}`)
    ;(deps.runtime ?? getRuntime)()
  } catch (err) {
    return fallBack(err instanceof Error ? err.message : String(err))
  }
  return engine(params, callbacks, ports, { ...runtimeDeps, catalog: () => snapshot })
}
