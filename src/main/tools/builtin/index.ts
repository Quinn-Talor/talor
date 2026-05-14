import { registerBuiltinTools as registerReadTool } from './read'
import { registerBuiltinTools as registerGlobTool } from './glob'
import { registerBuiltinTools as registerWriteTool } from './write'
import { registerBuiltinTools as registerLsTool } from './ls'
import { registerBuiltinTools as registerGrepTool } from './grep'
import { registerBuiltinTools as registerEditTool } from './edit'
import { registerBuiltinTools as registerBashTool } from './bash'
import { registerBuiltinTools as registerRequestContinuationTool } from './request-continuation'

export function registerAllBuiltinTools(): void {
  registerReadTool()
  registerGlobTool()
  registerWriteTool()
  registerLsTool()
  registerGrepTool()
  registerEditTool()
  registerBashTool()
  // v4 Phase 4a: 替代 pending_continuation talor block
  registerRequestContinuationTool()
}

registerAllBuiltinTools()

export {
  registerReadTool,
  registerGlobTool,
  registerWriteTool,
  registerLsTool,
  registerGrepTool,
  registerEditTool,
  registerBashTool,
  registerRequestContinuationTool,
}
