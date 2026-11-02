// src/main/runtime/engine.ts — 业务层：全局引擎与 interactive 执行环境
//
// 引擎：Talor 模型库、~/.talor/runs.db 运行档案（runArchive 单例，与 Trace 面板共用，保留 30 天）、electron-log 诊断日志。
// interactive 执行环境（interactiveEnvironment）：委托人联系得上，审批人按会话找授权端口；章程须知；
// 权限规则依次为工作区沙箱（Talor 敏感名单追加在引擎内置名单之后，不传 granted）、旧路径兜底危险模式、
// 高风险审批；审批时限比授权窗口自带的 5 分钟早 10 秒，超时由引擎记为 APPROVAL_TIMEOUT。
// caps 与缺省值浅合并（委托上限由 delegationCapsOf 从委托配置夹取后放进 caps.delegation，B2 重建执行环境时复用）。凭据库为 TalorVault，供 MCP 规格里的凭据引用。
// MCP 宿主（连接池）与运行用同一个凭据库，创建时预连接启用的服务器；应用退出时 shutdownRuntime
// 关闭引擎与连接池（stdio MCP 是普通子进程，不关会残留）。
// 启用插件的 hook 经 withHooks 进执行环境；引擎创建时就带上 hook 执行器宿主，hook 集合变化时
// setHooks 只重建执行环境（进行中的运行用原来的），bindPluginHooks 在插件变化时换上最新的 hook。
//
// 允许依赖: agent-engine、electron-log、runtime/*、repos/mcp-server-repo、store/config-store
// 禁止依赖: ipc/*、db/*

import log from 'electron-log'
import {
  createEngine,
  hookRunner as processHookRunner,
  mcpHost,
  modelHub,
  riskApproval,
  workspaceSandbox,
  type Approver,
  type Archive,
  type Caps,
  type Engine,
  type Environment,
  type EnvironmentConfig,
  type HookRunner,
  type HookSpec,
  type Logger,
  type McpHost,
  type McpServerSpec,
  type ModelHub,
  type Vault,
} from 'agent-engine'
import { hashOf } from 'agent-engine/sdk'
import { mcpServerRepo, type MCPServer } from '../repos/mcp-server-repo'
import { ConfigStore, type DelegationConfig } from '../store/config-store'
import { DEFAULT_CHILD_TIMEOUT_MS, MAX_DELEGATION_DEPTH } from './agents'
import { sessionApprover } from './approval'
import { mcpCatalogEntries } from './catalog'
import { talorFallbackRisk } from './fallback-risk'
import { withHooks } from './hooks'
import { electronLogger } from './logger'
import { talorModels } from './models'
import { ENGINE_NOTICE } from './notice'
import { onPluginsChanged, pluginHooks } from './plugins'
import { runArchive } from './run-archive'
import { TALOR_SENSITIVE_PATHS } from './tools'
import { talorVault } from './vault'

export { runArchive, runsDbPath } from './run-archive'
/** 审批等待上限：比 ipc/permission.ts 授权窗口自带的 5 分钟早 10 秒，超时由引擎判定。 */
export const APPROVAL_TIMEOUT_MS = 290_000

const positiveIntOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && Math.floor(value) >= 1
    ? Math.floor(value)
    : fallback

/** 委托配置 → 执行环境的委托上限；不合法的值回退到缺省（引擎要求正整数，否则 environment 抛错）。 */
export function delegationCapsOf(config: DelegationConfig): NonNullable<Caps['delegation']> {
  return {
    depth: MAX_DELEGATION_DEPTH,
    perAgent: positiveIntOr(config.maxInvocationsPerAgentPerSession, 3),
    concurrency: positiveIntOr(config.maxConcurrencyPerSession, 10),
  }
}

/** 根 agent 的子运行时长：至少 1 秒，否则用缺省值。 */
export function childTimeoutOf(config: DelegationConfig): number {
  const v = config.executionTimeoutMs
  return typeof v === 'number' && Number.isFinite(v) && v >= 1000
    ? Math.floor(v)
    : DEFAULT_CHILD_TIMEOUT_MS
}

export interface Runtime {
  engine: Engine
  /** 当前的 interactive 执行环境（hook 变化后是重建的那个）。 */
  readonly interactive: Environment
  /** 运行档案：投影按 blob 引用读工具结果正文。 */
  archive: Archive
  /** 换 hook：集合变化时重建执行环境，之后开始的运行用新的。 */
  setHooks(hooks: HookSpec[]): void
}

export function interactiveEnvironment(deps: {
  approver?: Approver
  caps?: Caps
}): EnvironmentConfig {
  return {
    name: 'interactive',
    principal: { reachable: true, ...(deps.approver ? { approver: deps.approver } : {}) },
    notice: [{ role: 'system', parts: [{ type: 'text', text: ENGINE_NOTICE }] }],
    permissions: [
      workspaceSandbox({ sensitive: [...TALOR_SENSITIVE_PATHS] }),
      talorFallbackRisk(),
      riskApproval({ mode: 'ask-high' }),
    ],
    caps: { approvalTimeoutMs: APPROVAL_TIMEOUT_MS, ...deps.caps },
  }
}

export function createRuntime(deps: {
  models: ModelHub
  archive: Archive
  approver?: Approver
  logger?: Logger
  vault?: Vault
  /** MCP 连接池；不传时引擎没有 MCP 宿主，mcp 能力准备时记为不可用。 */
  mcp?: McpHost
  /** 执行环境上限，与缺省值合并。 */
  caps?: Caps
  /** 启用插件的 hook。 */
  hooks?: HookSpec[]
  /** hook 执行器；有 hook 而不传时用真实进程执行器。 */
  hookRunner?: HookRunner
}): Runtime {
  const hooks = deps.hooks ?? []
  const runner = deps.hookRunner ?? (hooks.length > 0 ? processHookRunner() : undefined)
  const hosts = [deps.mcp, runner].filter((h): h is McpHost | HookRunner => h !== undefined)
  const engine = createEngine({
    services: {
      models: deps.models,
      archive: deps.archive,
      logger: deps.logger ?? electronLogger(),
      ...(deps.vault ? { vault: deps.vault } : {}),
      ...(hosts.length > 0 ? { hosts } : {}),
    },
  })
  const base = interactiveEnvironment({
    ...(deps.approver ? { approver: deps.approver } : {}),
    ...(deps.caps ? { caps: deps.caps } : {}),
  })
  let current = { key: hashOf(hooks), env: engine.environment(withHooks(base, hooks)) }
  return {
    engine,
    archive: deps.archive,
    get interactive() {
      return current.env
    },
    setHooks(next) {
      const key = hashOf(next)
      if (key === current.key) return
      current = { key, env: engine.environment(withHooks(base, next)) }
      log.info('[runtime] hooks changed, environment rebuilt:', next.length)
    },
  }
}

/** 插件变化时把最新的插件 hook 交给运行时；返回解绑函数。 */
export function bindPluginHooks(target: Pick<Runtime, 'setHooks'>): () => void {
  return onPluginsChanged(() => target.setHooks(pluginHooks()))
}

/** 预连接的规格：与目录里的 MCP 条目同源，连接池按规格哈希复用连接。 */
export function preconnectSpecs(servers: MCPServer[]): McpServerSpec[] {
  return mcpCatalogEntries(servers).map((entry) => entry.spec)
}

let runtime: Runtime | undefined
let unbindHooks: (() => void) | undefined
/** 上次创建失败的时间；退避期内不重建。 */
let failedAt: number | undefined

/** 运行时创建失败后不重建的时长。 */
export const RUNTIME_RETRY_MS = 60_000

/**
 * 构建运行时：先建带预连接的 MCP 宿主（会起 stdio 子进程），再建引擎；
 * 引擎创建抛异常时关闭已建的宿主，不留下子进程。
 */
export function buildRuntime(
  make: { mcp: () => McpHost; runtime: (mcp: McpHost) => Runtime } = defaultMake(),
): Runtime {
  const mcp = make.mcp()
  try {
    return make.runtime(mcp)
  } catch (err) {
    mcp.shutdown().catch(() => undefined)
    throw err
  }
}

function defaultMake(): { mcp: () => McpHost; runtime: (mcp: McpHost) => Runtime } {
  const vault = talorVault()
  return {
    mcp: () => mcpHost({ vault, preconnect: preconnectSpecs(mcpServerRepo.list()) }),
    runtime: (mcp) =>
      createRuntime({
        models: modelHub({ providers: [talorModels()] }),
        archive: runArchive(),
        approver: sessionApprover,
        vault,
        mcp,
        caps: { delegation: delegationCapsOf(ConfigStore.getInstance().getDelegation()) },
        hooks: pluginHooks(),
        hookRunner: processHookRunner(),
      }),
  }
}

/** 全局运行时；创建失败后 RUNTIME_RETRY_MS 内直接抛错，不再重建。 */
export function getRuntime(deps: { build?: () => Runtime; now?: () => number } = {}): Runtime {
  if (runtime) return runtime
  const now = (deps.now ?? Date.now)()
  if (failedAt !== undefined && now - failedAt < RUNTIME_RETRY_MS) {
    throw new Error(`引擎运行时创建失败，${RUNTIME_RETRY_MS} 毫秒内不再重建`)
  }
  try {
    runtime = (deps.build ?? buildRuntime)()
    failedAt = undefined
    unbindHooks = bindPluginHooks(runtime)
    return runtime
  } catch (err) {
    failedAt = now
    log.warn(`[runtime] create failed, retry after ${RUNTIME_RETRY_MS}ms`, err)
    throw err
  }
}

export function runtimeCreated(): boolean {
  return runtime !== undefined
}

/** 关闭引擎：停止进行中的运行，关闭 MCP 连接池。不传时关闭全局运行时；没创建过则什么都不做。 */
export async function shutdownRuntime(target?: Runtime): Promise<void> {
  const r = target ?? runtime
  if (!r) return
  if (!target) {
    runtime = undefined
    unbindHooks?.()
    unbindHooks = undefined
  }
  await r.engine.shutdown()
}

/** 启动时创建引擎并预连接 MCP 服务器，第一轮不用等建连；失败只记日志。 */
export function warmUpRuntime(): void {
  try {
    getRuntime()
  } catch (err) {
    log.warn('[runtime] warm-up failed', err)
  }
}
