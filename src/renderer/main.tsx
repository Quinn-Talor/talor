import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { artifactUI, type TalorFeatureRenderer } from './artifacts/registry'
import { investFeatureRenderer } from './invest/feature'
import './index.css'

// 组合根(renderer 半,唯一认识具体业务处):登记各业务 Feature 的渲染贡献(ArtifactUI)。
// 加新 Feature 在此数组加一项,平台渲染端零改动。
const RENDERER_FEATURES: TalorFeatureRenderer[] = [investFeatureRenderer]
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
