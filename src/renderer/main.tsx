import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { artifactUI, type TalorFeatureRenderer } from './artifacts/registry'
import './index.css'

// 组合根(renderer 半):登记各业务 Feature 的渲染贡献(ArtifactUI)—— 当前为空
// (平台框架就绪,业务 feature 后续在此数组加一项,平台渲染端零改动)。
const RENDERER_FEATURES: TalorFeatureRenderer[] = []
for (const f of RENDERER_FEATURES) {
  for (const ui of f.ui()) {
    if (!artifactUI.get(ui.type)) artifactUI.register(ui)
  }
}

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
