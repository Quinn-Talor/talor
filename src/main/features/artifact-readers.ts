// src/main/features/artifact-readers.ts — 业务对象读口注册表(按 type,main 侧)
//
// Feature 声明 FeatureArtifact{type,read};平台按 type 存。组合根挂一个**通用** IPC
// `artifact:read`,据此路由到对应 feature 的 read —— 替代各 feature 自开 <biz>:card:read。
// 渲染端 talorAPI.artifact.read(type,id) 走此通道。
//
// 允许依赖:./types
// 禁止依赖:electron(IPC 挂载在组合根)/ 具体业务

import type { FeatureArtifact } from './types'

/** 按 type 注册 / 查找业务对象读口。 */
export class ArtifactReaderRegistry {
  private readonly readers = new Map<string, (id: string) => unknown>()

  register(artifact: FeatureArtifact): void {
    if (this.readers.has(artifact.type)) {
      throw new Error(`Artifact reader already registered: ${artifact.type}`)
    }
    this.readers.set(artifact.type, artifact.read)
  }

  /** 按 type 取数;无对应读口返 null。 */
  read(type: string, id: string): unknown {
    return this.readers.get(type)?.(id) ?? null
  }
}
