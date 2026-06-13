// src/shared/types/artifact.ts — 业务对象框架抽象(card / robot 等所有业务对象共用)
//
// 三抽象之二(对象 + 存储)。纯接口,无运行时依赖、无 React、无 main/renderer 依赖。
// 第三个抽象 ArtifactUI(渲染,含 React)在 renderer 侧定义(见 renderer/artifacts/registry.ts)。
//
// 设计依据:docs/talor-feature-architecture.md §2。
//   - 读写都抽象(read + apply),但写不退化成通用 CRUD:apply 的"形状"统一,
//     "内容"由 feature 自定的 Cmd 联合定型(卡 appendSnapshot ≠ 机器人 moveTo)。
//   - subscribe? 可选 capability:活对象(机器人遥测)实现,静态对象(卡快照)不实现。

/** 业务对象最小恒等。一切对象(stock_card / robot / …)的基。 */
export interface Artifact {
  readonly id: string
  readonly type: string
}

/**
 * 对象存储端口:读 + 写 + 可选订阅,统一抽象。feature 提供具体实现。
 *
 * @typeParam T   - 对象的读取形态(extends Artifact)
 * @typeParam Cmd - 写命令的联合类型(按 feature 定型;默认 unknown)
 */
export interface ArtifactStore<T extends Artifact = Artifact, Cmd = unknown> {
  /** 快照读;不存在返回 null。 */
  read(id: string): T | null
  /** 写:统一入口,domain 校验在实现内按 cmd 分发,返回写后当前态(read-after-write)。 */
  apply(cmd: Cmd): T
  /** 可选:活对象订阅变更,返回取消订阅函数。静态对象不实现。 */
  subscribe?(id: string, onChange: (next: T) => void): () => void
}
