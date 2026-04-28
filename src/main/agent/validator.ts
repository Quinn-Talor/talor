// src/main/agent/validator.ts — 业务层：AgentProfile 结构化校验
//
// 对 agent.json 做 8 项校验，收集全部错误后一次性返回。
//
// 允许依赖：shared/*
// 禁止依赖：ipc/*、repos/*

import { valid as semverValid } from 'semver'
import type { AgentProfile, ValidateProfileResult } from '@shared/types/agent'

export function validateProfile(json: unknown): ValidateProfileResult {
  const errors: string[] = []
  const obj = json as Record<string, unknown>

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { valid: false, errors: ['input must be a non-null object'] }
  }

  if (typeof obj.id !== 'string' || obj.id.trim() === '') {
    errors.push('"id" must be a non-empty string')
  }

  if (typeof obj.name !== 'string' || obj.name.trim() === '') {
    errors.push('"name" must be a non-empty string')
  }

  if (typeof obj.description !== 'string' || obj.description.trim() === '') {
    errors.push('"description" must be a non-empty string')
  }

  if (typeof obj.version !== 'string' || !semverValid(obj.version)) {
    errors.push('"version" must be a valid semver')
  }

  if (obj.minAppVersion !== undefined && obj.minAppVersion !== null) {
    if (typeof obj.minAppVersion !== 'string' || !semverValid(obj.minAppVersion)) {
      errors.push('"minAppVersion" must be a valid semver')
    }
  }

  const role = obj.role as Record<string, unknown> | undefined
  if (!role || typeof role !== 'object') {
    errors.push('"role" must be an object')
  } else {
    if (!Array.isArray(role.capabilities) || role.capabilities.length === 0) {
      errors.push('"role.capabilities" must be a non-empty array')
    }
    if (typeof role.outputFormat !== 'string' || (role.outputFormat as string).trim() === '') {
      errors.push('"role.outputFormat" must be a non-empty string')
    }
  }

  const deps = obj.dependencies as Record<string, unknown> | undefined
  if (!deps || typeof deps !== 'object') {
    errors.push('"dependencies" must be an object')
  } else {
    if (!Array.isArray(deps.tools)) {
      errors.push('"dependencies.tools" must be an array')
    }
    if (deps.mcpServers !== undefined && !Array.isArray(deps.mcpServers)) {
      errors.push('"dependencies.mcpServers" must be an array')
    }
    if (!Array.isArray(deps.skills)) {
      errors.push('"dependencies.skills" must be an array')
    }
    if (!Array.isArray(deps.cli)) {
      errors.push('"dependencies.cli" must be an array')
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  const profile = obj as unknown as AgentProfile
  if (!profile.dependencies.mcpServers) {
    profile.dependencies.mcpServers = []
  }

  return { valid: true, profile }
}
