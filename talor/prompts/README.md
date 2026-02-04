# Talor Prompts

This directory contains all system prompts used by Talor's plugin system.

## Structure

```
prompts/
├── system.md           # System-level ReAct framework prompt
├── agents/             # Agent-specific role prompts
│   ├── build.md        # Executor agent
│   ├── plan.md         # Planner agent
│   ├── explore.md      # Explorer agent
│   └── general.md      # General purpose agent
├── llm/                # LLM model-specific prompts
│   ├── claude4.md      # Claude 4 series
│   ├── claude35.md     # Claude 3.5 series
│   ├── claude3.md      # Claude 3 series
│   ├── gpt5.md         # GPT-5 series
│   ├── gpt4o.md        # GPT-4o series
│   ├── gpt4.md         # GPT-4 series
│   ├── o3.md           # o3 reasoning models
│   ├── o1.md           # o1 reasoning models
│   ├── gemini3.md      # Gemini 3 series
│   ├── gemini2.md      # Gemini 2.0 series
│   ├── gemini2-thinking.md  # Gemini 2.0 thinking
│   ├── gemini15.md     # Gemini 1.5 series
│   ├── deepseek-v3.md  # DeepSeek V3 series
│   ├── deepseek-r1.md  # DeepSeek R1 reasoning
│   ├── llama4.md       # Llama 4 series
│   ├── llama3.md       # Llama 3 series
│   ├── mistral.md      # Mistral series
│   ├── mistral-code.md # Codestral
│   ├── qwen.md         # Qwen series
│   ├── qwen-code.md    # Qwen Coder
│   ├── grok.md         # Grok series
│   └── default.md      # Default/unknown models
├── memory/             # Memory system prompts
│   └── summarize.md    # Conversation summarization prompt
└── README.md           # This file
```

## Usage

Prompts are loaded at runtime by the plugin system and memory system:

- **SystemPromptPlugin** loads `system.md`
- **AgentPromptPlugin** loads from `agents/{agent_name}.md`
- **LLMPlugin** loads from `llm/{model_family}.md`
- **SummarizerFactory** loads from `memory/summarize.md`

## Editing Prompts

### System Prompt (`system.md`)
Contains the ReAct framework definition and universal rules that apply to all agents.

**Structure:**
- ReAct Framework (Reason → Act → Observe → Repeat)
- Universal Principles
- System Boundaries
- Communication Guidelines

### Agent Prompts (`agents/*.md`)
Contains role-specific definitions for each agent.

**Structure:**
- Your Role (role definition)
- Core Responsibilities
- Behavioral Guidelines
- Tool Access
- Workflow Pattern

### LLM Prompts (`llm/*.md`)
Contains model-specific guidance and best practices for different LLM families.

**Structure:**
- Model identification and description
- Strengths (key capabilities)
- Limitations (if any)
- Best Practices (usage recommendations)

**Naming Convention:**
- Files are named by model family (e.g., `claude4.md`, `gpt5.md`, `deepseek-r1.md`)
- Model family is determined by LLMPlugin's MODEL_CONFIGS mapping
- `default.md` is used for unknown models

### Memory Prompts (`memory/*.md`)
Contains prompts for memory system operations.

**Files:**
- `summarize.md` - Conversation summarization prompt with `{{conversation}}` placeholder

## Best Practices

1. **Keep it concise** - Avoid redundant information
2. **Be specific** - Clear, actionable instructions
3. **Maintain consistency** - Use similar structure across agents
4. **Test changes** - Run tests after modifying prompts
5. **Document changes** - Update this README when adding new prompts

## Token Budget

Current token usage (approximate):
- System prompt: ~3500 tokens
- Agent prompts: ~1500 tokens each
- LLM prompts: ~200-400 tokens each
- Memory summarize prompt: ~300 tokens
- Total per request: ~5000-5500 tokens

## Adding New Agents

To add a new agent:

1. Create `agents/{agent_name}.md`
2. Follow the standard structure (see existing agents)
3. Plugin will automatically load the new file
4. Add tests in `tests/plugin/test_builtin.py`
5. Update this README

## Adding New LLM Prompts

To add a new LLM model family:

1. Create `llm/{model_family}.md`
2. Follow the standard structure (see existing LLM prompts)
3. Update `MODEL_CONFIGS` in `src/plugin/builtin/llm.py` to map models to the family
4. Plugin will automatically load the new file
5. Add tests if needed
6. Update this README

## Adding New Memory Prompts

To add a new memory prompt:

1. Create `memory/{prompt_name}.md`
2. Use `{{placeholder}}` syntax for dynamic content
3. Update `SummarizerFactory` or relevant code to load it
4. Add tests
5. Update this README

## Related Files

- `src/plugin/builtin/system.py` - Loads system.md
- `src/plugin/builtin/agent.py` - Loads agents/*.md
- `src/plugin/builtin/llm.py` - Loads llm/*.md
- `src/memory/short_term.py` - Loads memory/summarize.md (via SummarizerFactory)
- `tests/plugin/test_builtin.py` - Plugin tests
- `tests/memory/test_short_term.py` - Memory tests
