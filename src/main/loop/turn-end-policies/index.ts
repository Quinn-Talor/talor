// src/main/loop/turn-end-policies/index.ts — Module barrel
//
// 对外暴露的接口 + 3 个 policy (v4 Phase 4a 后) + chain runner + builder。
// react-loop / 测试代码统一从这里 import,不直接深入各 policy 文件。
//
// v4 Phase 4a 移除:
//   - PendingContinuationBlockPolicy — request_continuation virtual tool 替代

export type { TurnEndDecision, TurnEndPolicy, PolicyContext } from './types'
export { NO_OPINION } from './types'
export { SdkFinishReasonPolicy } from './sdk-finish-reason'
export { ExplicitTerminationBlockPolicy } from './explicit-termination'
export { LegacyNaturalFinalPolicy } from './legacy'
export { runPolicyChain, buildDefaultChain } from './chain'
