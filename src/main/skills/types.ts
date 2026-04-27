export interface SkillMetadata {
  name: string
  version?: string
  description: string
  requires?: { bins?: string[] }
  cliHelp?: string
}

export interface ParsedSkill {
  metadata: SkillMetadata
  content: string
  filePath: string
}
