export { registerBuiltinTools as registerReadTool } from './read'
export { registerBuiltinTools as registerGlobTool } from './glob'

import './read'
import './glob'

export function registerAllBuiltinTools(): void {
  // Tools are registered when imported
}