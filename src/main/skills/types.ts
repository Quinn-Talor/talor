export interface SkillMetadata {
  name: string
  version?: string
  description: string
  /**
   * Anthropic 官方 skill spec 字段: "Additional context for when Claude
   * should invoke the skill, such as trigger phrases or example requests."
   * (code.claude.com/docs/en/skills.md)
   *
   * 自由文本——通常写"触发短语 + 示例请求"的混合。Layer 4 skill listing
   * 渲染成 `When to use: ...` 一行,帮模型把用户意图对齐到 skill。
   *
   * 保持与官方字段名 snake_case 一致(不改写成 whenToUse),便于未来与
   * Anthropic/Claude Code 的 skill 目录互通——同一 SKILL.md 可跨平台使用。
   */
  when_to_use?: string
  requires?: { bins?: string[] }
  cliHelp?: string
}

export interface ParsedSkill {
  metadata: SkillMetadata
  content: string
  filePath: string
}
