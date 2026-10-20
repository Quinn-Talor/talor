import { describe, it, expect } from 'vitest'
import type { ObservationRecord } from '@shared/types/trace'
import { buildObservationTree, displayName, usageTotals, visibleTree } from './trace-tree'

function obs(
  id: string,
  parent: string | null,
  start: string,
  end: string | null,
  overrides: Partial<ObservationRecord> = {},
): ObservationRecord {
  return {
    id,
    trace_id: 't1',
    parent_observation_id: parent,
    type: 'SPAN',
    name: id,
    start_time: start,
    end_time: end,
    completion_start_time: null,
    level: 'DEFAULT',
    status_message: null,
    provided_model_name: null,
    model_parameters: null,
    input: null,
    output: null,
    metadata: {},
    usage_details: null,
    cost_details: null,
    prompt_name: null,
    prompt_version: null,
    version: null,
    environment: 'development',
    ...overrides,
  }
}

describe('buildObservationTree', () => {
  it('nests by parent id, orders siblings by start_time and computes durations', () => {
    const tree = buildObservationTree([
      obs('step-2', 'root', '2026-10-19T10:00:05.000Z', '2026-10-19T10:00:06.000Z'),
      obs('root', null, '2026-10-19T10:00:00.000Z', '2026-10-19T10:00:09.000Z'),
      obs('step-1', 'root', '2026-10-19T10:00:01.000Z', '2026-10-19T10:00:01.250Z'),
      obs('gen', 'step-1', '2026-10-19T10:00:01.010Z', null),
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0].observation.id).toBe('root')
    expect(tree[0].durationMs).toBe(9000)
    expect(tree[0].children.map((c) => c.observation.id)).toEqual(['step-1', 'step-2'])
    expect(tree[0].children[0].durationMs).toBe(250)
    expect(tree[0].children[0].children[0].durationMs).toBeNull()
  })

  it('nodes whose parent is missing become roots', () => {
    const tree = buildObservationTree([
      obs('orphan', 'ghost', '2026-10-19T10:00:02.000Z', '2026-10-19T10:00:03.000Z'),
      obs('root', null, '2026-10-19T10:00:00.000Z', '2026-10-19T10:00:09.000Z'),
    ])
    expect(tree.map((n) => n.observation.id)).toEqual(['root', 'orphan'])
  })

  it('returns an empty forest for no observations', () => {
    expect(buildObservationTree([])).toEqual([])
  })
})

describe('visibleTree', () => {
  // root → step → [debug-leaf(DEBUG), guard(DEBUG) → gen(DEFAULT), quiet(DEBUG) → quiet-child(DEBUG)]
  function forest() {
    return buildObservationTree([
      obs('root', null, '2026-10-19T10:00:00.000Z', '2026-10-19T10:00:09.000Z', { type: 'AGENT' }),
      obs('step', 'root', '2026-10-19T10:00:01.000Z', '2026-10-19T10:00:08.000Z'),
      obs('debug-leaf', 'step', '2026-10-19T10:00:02.000Z', '2026-10-19T10:00:02.000Z', {
        level: 'DEBUG',
      }),
      obs('guard', 'step', '2026-10-19T10:00:03.000Z', '2026-10-19T10:00:05.000Z', {
        type: 'EVALUATOR',
        level: 'DEBUG',
      }),
      obs('gen', 'guard', '2026-10-19T10:00:03.100Z', '2026-10-19T10:00:04.900Z', {
        type: 'GENERATION',
        level: 'ERROR',
      }),
      obs('quiet', 'step', '2026-10-19T10:00:06.000Z', '2026-10-19T10:00:06.000Z', {
        level: 'DEBUG',
      }),
      obs('quiet-child', 'quiet', '2026-10-19T10:00:06.000Z', '2026-10-19T10:00:06.000Z', {
        level: 'DEBUG',
      }),
    ])
  }

  function ids(nodes: ReturnType<typeof visibleTree>): unknown[] {
    return nodes.map((n) =>
      n.children.length > 0
        ? { [n.observation.id]: ids(n.children), dimmed: n.dimmed }
        : n.observation.id,
    )
  }

  it('hiding DEBUG keeps a DEBUG parent as a dimmed context row when it has visible descendants', () => {
    const [root] = visibleTree(forest(), false)
    const [step] = root.children
    expect(step.children.map((c) => c.observation.id)).toEqual(['guard'])
    const [guard] = step.children
    expect(guard.dimmed).toBe(true)
    // DEBUG 守卫下的模型调用(此处为 ERROR)不能随父节点一起被藏掉
    expect(guard.children.map((c) => c.observation.id)).toEqual(['gen'])
    expect(guard.children[0].dimmed).toBe(false)
    expect(root.dimmed).toBe(false)
  })

  it('(no-trigger) showing DEBUG keeps every node and dims none', () => {
    const all = visibleTree(forest(), true)
    expect(ids(all)).toEqual([
      {
        root: [
          {
            step: [
              'debug-leaf',
              { guard: ['gen'], dimmed: false },
              { quiet: ['quiet-child'], dimmed: false },
            ],
            dimmed: false,
          },
        ],
        dimmed: false,
      },
    ])
  })
})

describe('displayName', () => {
  it('numbers react.step rows from metadata.step_index (1-based)', () => {
    expect(
      displayName(obs('s', null, 'a', 'b', { name: 'react.step', metadata: { step_index: 0 } })),
    ).toBe('react.step #1')
    expect(
      displayName(obs('s', null, 'a', 'b', { name: 'react.step', metadata: { step_index: 3 } })),
    ).toBe('react.step #4')
  })

  it('(no-trigger) other names, or a step without a numeric index, are shown unchanged', () => {
    expect(
      displayName(obs('t', null, 'a', 'b', { name: 'stock_basic', metadata: { step_index: 1 } })),
    ).toBe('stock_basic')
    expect(displayName(obs('s', null, 'a', 'b', { name: 'react.step', metadata: {} }))).toBe(
      'react.step',
    )
  })
})

describe('usageTotals', () => {
  it('sums the five usage buckets over GENERATION observations only', () => {
    const totals = usageTotals([
      obs('g1', null, 'a', 'b', {
        type: 'GENERATION',
        usage_details: {
          input: 7,
          output: 5,
          cache_read_input_tokens: 3,
          cache_creation_input_tokens: 1,
          output_reasoning_tokens: 2,
          total: 18,
        },
      }),
      obs('g2', null, 'a', 'b', { type: 'GENERATION', usage_details: { input: 1, output: 1 } }),
      obs('s', null, 'a', 'b', { usage_details: { input: 100 } }),
    ])
    expect(totals).toEqual({
      input: 8,
      output: 6,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 1,
      output_reasoning_tokens: 2,
    })
  })
})
