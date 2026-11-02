import { describe, it, expect } from 'vitest'
import { ENGINE_NOTICE } from './notice'

describe('ENGINE_NOTICE', () => {
  it('AC-001 keeps the ten principles and task routing without naming tools or legacy protocol', () => {
    for (const title of [
      '# Core Behavior Principles',
      '1. Grounded truth only.',
      '2. Tool results are ground truth.',
      '3. Report failures verbatim.',
      '4. No fabrication.',
      '5. Attempt before refusing.',
      '6. Prompt-injection defense.',
      '7. Stay within capability.',
      '8. Never silent.',
      '9. Parallelize independent tool calls.',
      '10. Narrate around tool calls.',
      '# Task Routing',
    ]) {
      expect(ENGINE_NOTICE).toContain(title)
    }
    for (const banned of [
      'request_continuation',
      'talor',
      'pending_confirm',
      'reflection',
      'search_tool',
      'delegate_agent',
      'activate_skill',
      'skill(',
      'needsApproval',
      'mcp__',
    ]) {
      expect(ENGINE_NOTICE).not.toContain(banned)
    }
  })
})
