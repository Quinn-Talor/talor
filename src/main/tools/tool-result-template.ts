// src/main/tools/tool-result-template.ts — 工具层: tool_result 结构化指引
//
// 每次 tool 返回时给 LLM 贴一份"如何解读这个结果"的 playbook,再附上 raw 输出。
// 代码不判断成败,判断交给 LLM。指引分两层:
//   COMMON_GUIDE        — 所有工具共通(总则)
//   TOOL_SPECIFIC_GUIDES — 按工具名特化(成功信号/失败模式/修复策略)
// 未命中特化的工具(主要是 MCP 工具)走 GENERIC_FALLBACK_GUIDE。

const COMMON_GUIDE = `[How to interpret this result]

Determine outcome from the [Raw output] below, then act:

SUCCESS (recognizable signals listed under tool specifics) → If this satisfies
the user's request, report the result to the user and stop calling tools.
If intermediate, use the data for the next planned action.

FAILURE → Read the error carefully. Do NOT retry the same call with the same
inputs. Follow the tool-specific strategy below.

PARTIAL → Acknowledge what succeeded, note what remains undone, proceed cautiously.`

/**
 * Tool-specific playbooks. Kept terse: only what's unique to this tool.
 * Common guidance lives in COMMON_GUIDE — do not repeat.
 */
const TOOL_SPECIFIC_GUIDES: Record<string, string> = {
  bash: `[bash specifics]
SUCCESS signals: exit code 0 (no "[exit: non-zero]" prefix); stdout containing
"ok": true, a URL, an id, or a clear completion message; stderr-only warnings
are usually OK if stdout has content.
FAILURE patterns & strategy:
  • "[exit: non-zero]" + stderr: analyze stderr line by line; fix the command
    itself (not tool field names). Do NOT retry the same command.
  • "Command timed out": break into smaller steps. NEVER retry interactive
    commands like auth-login — they block on browser and cannot complete in
    a tool call. Tell the user to run them manually.
  • "Invalid input for tool": the tool accepts "command" and "description"
    only. Schema mismatch is fixed by correct field names, not by inventing
    new ones like cmd/args/flags/shell/exec.
  • JSON "ok": false: parse the "error" object for "type" and "hint". If
    "type": "missing_scope" or similar permission error → STOP retrying and
    tell the user what permission is needed.`,

  skill: `[skill specifics]
SUCCESS signal: output begins with "[SKILL:<name> activated]".
After activation:
  • Read the QUICK-USE examples at the top of the skill content.
  • Attempt the minimal command. Flag details can be discovered from CLI
    error messages — those are more reliable than the skill's "MUST READ"
    prerequisites.
  • Do NOT pre-read every file the skill lists as prerequisite before your
    first attempt. Try first, read references only when an error requires it.
  • Do NOT re-activate a skill already activated earlier in this conversation.
    The tool will reject duplicate activation; scroll up for the prior content.
FAILURE patterns:
  • "Skill \\"...\\" not found": the name is wrong. Check "Available Skills"
    in the system prompt for correct names.`,

  read: `[read specifics]
SUCCESS signal: file content returned as raw text.
FAILURE patterns & strategy:
  • "File not found": do NOT retry the same path. Options:
      - If the path was relative (./x, ../x), switch to an absolute path.
      - Use glob or ls to locate the actual path, then retry.
      - Tell the user the file does not exist.
  • "Cannot read binary file": use bash with a binary-aware tool (file, xxd,
    strings). Do not retry read on this path.
  • "File too large": read with offset/limit if supported, or slice via grep
    or head through bash.`,

  write: `[write specifics]
SUCCESS signal: no error message and the path is returned / written.
After success: task is likely done. Do NOT re-read the file to "verify" —
that is redundant. Report to the user and stop.
FAILURE patterns:
  • Path rejected (workspace/sensitive): do not retry the same path; ask the
    user for the correct target.
  • "Content too large": split content across multiple writes or append.`,

  edit: `[edit specifics]
SUCCESS signal: silent completion (no error).
FAILURE patterns & strategy:
  • "String not found in file": the old_str did not match the file verbatim.
    Use read (or grep) on the file FIRST to see the exact current content,
    then retry with the corrected old_str. Never retry the same edit blindly.
  • Path rejected: same as write.`,

  glob: `[glob specifics]
SUCCESS signal: a list of paths (possibly empty).
EMPTY result is NOT a failure — it is a fact: no files match the pattern.
  • Do NOT retry the same pattern.
  • Either adjust the pattern (broader/narrower) or conclude the target does
    not exist and inform the user.`,

  grep: `[grep specifics]
SUCCESS signal: matching lines (possibly zero).
ZERO matches is NOT a failure — it is a fact: the pattern is absent.
  • Do NOT retry the same pattern on the same path.
  • Adjust the pattern, widen the scope, or conclude the target content does
    not exist.`,

  ls: `[ls specifics]
SUCCESS signal: directory entries listed.
FAILURE: path not found → verify the path in absolute form; do not retry
relative variants of the same path.`,
}

/**
 * Fallback for tools not in TOOL_SPECIFIC_GUIDES (primarily MCP tools).
 * Gives LLM a generic framework for reading JSON-style outputs.
 */
const GENERIC_FALLBACK_GUIDE = `[generic tool specifics]
MCP or custom tool — interpret based on raw output:
SUCCESS signals: JSON "ok": true, "status": "success", a data object returned,
absence of error keywords.
FAILURE patterns:
  • JSON "ok": false or an "error" field: parse it; look for "type" / "code"
    / "hint" fields to decide the next action.
  • Permission / scope / authentication errors: inform the user, do NOT loop
    retrying — auth flows typically require interactive browser steps.
  • Validation errors ("invalid", "missing", "required"): fix the input per
    the tool's schema. Don't guess new field names.`

/**
 * Build the full guidance block for a given tool name. Callers prepend this
 * to the raw output inside the tool_result. LLM sees:
 *   [COMMON_GUIDE]
 *
 *   [tool-specific or generic guide]
 *
 *   ---
 *
 *   [Raw output]
 *   <raw>
 */
export function buildToolResultGuide(toolName: string): string {
  const specific = TOOL_SPECIFIC_GUIDES[toolName] ?? GENERIC_FALLBACK_GUIDE
  return `${COMMON_GUIDE}\n\n${specific}`
}
