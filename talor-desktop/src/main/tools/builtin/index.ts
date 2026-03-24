import { registerBuiltinTools as registerReadTool } from './read'
import { registerBuiltinTools as registerGlobTool } from './glob'

export function registerAllBuiltinTools(): void {
  registerReadTool()
  registerGlobTool()
}

registerAllBuiltinTools()

export { registerReadTool, registerGlobTool }
