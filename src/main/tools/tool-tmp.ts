import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { v4 as uuidv4 } from 'uuid'

const TMP_ROOT = join(homedir(), '.talor', 'tmp')

/**
 * Writes content to ~/.talor/tmp/<sessionId>/<id>.txt
 * Returns the absolute file path to include in tool output.
 */
export function writeTmpOutput(sessionId: string, content: string): string {
  const dir = join(TMP_ROOT, sessionId)
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, `${uuidv4().slice(0, 8)}.txt`)
  writeFileSync(filePath, content, 'utf-8')
  return filePath
}
