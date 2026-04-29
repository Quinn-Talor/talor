export const ToolErrors = {
  missingParam: (field: string, toolName: string, required: string[]) =>
    `Missing required parameter: "${field}". ${toolName} requires: [${required.join(', ')}].`,

  invalidType: (field: string, expected: string, got: string) =>
    `Invalid type for "${field}": expected ${expected}, got ${got}.`,

  pathOutsideWorkspace: (path: string) =>
    `Cannot access path outside workspace: "${path}". Use ls or glob to find the correct path.`,

  fileNotFound: (path: string) =>
    `File not found: "${path}". Use ls or glob to find the correct path.`,

  unknownFlag: (command: string) => {
    const base = command.trim().split(/\s+/).slice(0, 2).join(' ')
    return `Command failed: unknown flag or command.\n[hint: run "${base} --help" to see available options]`
  },

  outputSaved: (previewBytes: number, totalBytes: number, filePath: string) =>
    `[partial preview: first ${previewBytes} of ${totalBytes} bytes]\n` +
    `[Full output saved to: ${filePath}]\n` +
    `[Use read tool to load the full content or specific sections]`,
}
