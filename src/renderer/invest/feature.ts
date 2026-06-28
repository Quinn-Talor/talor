// src/renderer/invest/feature.ts —— renderer: invest Feature 渲染半(贡献 ArtifactUI)
//
// 设计依据: docs/talor-feature-architecture.md §3/§4(renderer 半契约)。

import type { TalorFeatureRenderer } from '../artifacts/registry'
import { stockCardUI } from './stockCardUI'

export const investFeatureRenderer: TalorFeatureRenderer = {
  id: 'invest',
  ui: () => [stockCardUI],
}
