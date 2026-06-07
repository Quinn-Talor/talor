// src/main/agent/profile-fs.ts — 业务层: AgentProfile 磁盘读写 (含 prompt.md 拆分)
//
// 磁盘布局:
//   <agentDir>/agent.json   — profile 元数据 (不含 agentPrompt 字段)
//   <agentDir>/prompt.md    — 完整 agentPrompt 内容
//
// 运行时 AgentProfile 类型仍带 agentPrompt: string 字段;读写两端做拆/合。
//
// 允许依赖: fs / path / shared/*
// 禁止依赖: ipc/*

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentProfile } from '@shared/types/agent'

export const PROMPT_FILE = 'prompt.md'
export const AGENT_JSON = 'agent.json'

/**
 * 从 agent 目录加载完整 profile(合并 agent.json + prompt.md)。
 *
 * @throws Error 当 agent.json 或 prompt.md 缺失
 */
export function loadAgentBundle(dirPath: string): { raw: unknown; agentPrompt: string } {
  const jsonPath = join(dirPath, AGENT_JSON)
  const promptPath = join(dirPath, PROMPT_FILE)

  if (!existsSync(jsonPath)) {
    throw new Error(`agent.json missing at ${jsonPath}`)
  }

  const raw = JSON.parse(readFileSync(jsonPath, 'utf-8')) as Record<string, unknown>

  // agent.json 不应含 agentPrompt(应该在 sibling prompt.md);若发现则提示
  if ('agentPrompt' in raw) {
    throw new Error(
      `agent.json should not contain agentPrompt field — move it to sibling ${PROMPT_FILE}`,
    )
  }

  if (!existsSync(promptPath)) {
    throw new Error(`${PROMPT_FILE} missing at ${promptPath}`)
  }

  const agentPrompt = readFileSync(promptPath, 'utf-8')
  return { raw, agentPrompt }
}

/**
 * 把完整 profile(含 agentPrompt)拆成两个文件落盘。
 * agent.json 内不含 agentPrompt 字段;prompt.md 即 agentPrompt 内容。
 */
export function persistAgentProfile(profile: AgentProfile, dirPath: string): void {
  const { agentPrompt, ...rest } = profile
  writeFileSync(join(dirPath, AGENT_JSON), JSON.stringify(rest, null, 2), 'utf-8')
  writeFileSync(join(dirPath, PROMPT_FILE), agentPrompt, 'utf-8')
}

/**
 * 单独更新 agentPrompt(prompt.md),不动 agent.json。
 * 供 prompt-only edit 场景。
 */
export function persistAgentPrompt(agentPrompt: string, dirPath: string): void {
  writeFileSync(join(dirPath, PROMPT_FILE), agentPrompt, 'utf-8')
}
