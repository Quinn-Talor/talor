# Talor

**Your Local AI Agent Assistant**

Talor is a local AI assistant that runs entirely on your machine. Built on the ReAct (Reasoning + Acting) architecture, it helps you with coding, file management, automation, and more - all while keeping your data private and local.

## Why Talor?

- 🏠 **100% Local** - Runs on your machine, your data never leaves
- 🧠 **Smart ReAct Loop** - Thinks, acts, and learns from results iteratively
- 🔌 **Bring Your Own LLM** - Works with OpenAI, Anthropic, Claude, local models (Ollama), and more
- 🛠️ **Powerful Tools** - File operations, bash commands, git integration, and extensible via MCP
- 💬 **Natural Interaction** - Chat-based interface with real-time feedback
- 🎯 **Multiple Agents** - Specialized agents for different tasks (coding, planning, exploration)

## Use Cases

- **Coding Assistant** - Write, refactor, and debug code with AI help
- **File Management** - Search, organize, and manipulate files intelligently
- **Automation** - Automate repetitive tasks with natural language
- **Research** - Gather and analyze information from your local files
- **DevOps Helper** - Manage deployments, logs, and configurations

## How It Works

```
You: "Add error handling to auth.py"
  ↓
Talor: [Thinks] Need to read the file first
  ↓
Talor: [Acts] Reads auth.py
  ↓
Talor: [Observes] Found 3 functions without try-catch
  ↓
Talor: [Acts] Adds error handling
  ↓
Talor: "Done! Added error handling to login(), register(), and verify_token()"
```

## Architecture

Talor consists of two components that run locally:

- **Backend** (`talor/`) - Python service handling AI logic, tools, and memory
- **Desktop Client** (`talor-gui/`) - React-based desktop application for interaction

Both run on `localhost` - no external servers involved.

### Deployment Options

- **Desktop App** (Primary) - Standalone desktop application (Electron/Tauri)
  - Current: Web-based UI (development mode)
  - Planned: Native desktop packaging
- **CLI Mode** (Planned) - Terminal-only interface for headless usage
- **IDE Extension** (Future) - VS Code/JetBrains plugin integration

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- An LLM API key (OpenAI, Anthropic, etc.) or local model (Ollama)

### 1. Install Backend

```bash
cd talor

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install
pip install -e ".[dev]"

# Configure
cp config.example.yaml config.yaml
# Edit config.yaml with your LLM API keys
```

### 2. Install Desktop Client

```bash
cd talor-gui
npm install
```

### 3. Start Talor

```bash
# Terminal 1: Start backend
cd talor
source venv/bin/activate
talor serve    # Runs on http://127.0.0.1:8000

# Terminal 2: Start desktop client (development mode)
cd talor-gui
npm run dev    # Opens desktop UI at http://localhost:5173
```

### 4. Start Chatting!

The desktop client will open automatically and connect to the local backend.

**First-time tips:**
- Try: "List all Python files in this project"
- Try: "Explain what the agent/executor.py file does"
- Try: "Create a hello.py file that prints 'Hello, Talor!'"

## Tech Stack

### Backend

| Category | Technology |
|----------|------------|
| Language | Python 3.11+ |
| Framework | FastAPI + Uvicorn |
| LLM | LiteLLM |
| MCP | FastMCP |
| Validation | Pydantic v2 |
| Storage | aiosqlite |
| Testing | pytest, hypothesis |

### Frontend

| Category | Technology |
|----------|------------|
| Language | TypeScript |
| Framework | React 19 |
| Build | Vite |
| State | Zustand |
| Styling | TailwindCSS v4 |
| i18n | i18next |
| Testing | Vitest, fast-check |

## Key Features Explained

### ReAct Architecture

Talor doesn't just respond - it thinks and acts:
1. **Reason** - Analyzes your request and plans next steps
2. **Act** - Executes tools (read files, run commands, etc.)
3. **Observe** - Reviews results and adjusts approach
4. **Repeat** - Continues until task is complete

### Multiple Agents

Choose the right agent for your task:
- **build** - Full-featured coding agent (default)
- **plan** - Read-only planner for analysis and design
- **explore** - Quick file exploration and search
- **general** - General-purpose research and reasoning

### Memory System

Talor remembers your conversation:
- Automatically summarizes long conversations
- Keeps context relevant and within token limits
- Preserves important information (errors, tool results)

### Tool System

Built-in tools for common tasks:
- **File Operations** - read, write, edit, search
- **Shell Commands** - Execute bash/shell commands
- **Git Integration** - Version control operations
- **Extensible** - Add custom tools via MCP protocol

## Development Commands

### Backend

```bash
cd talor
source venv/bin/activate

# Testing
pytest tests/ -v
pytest --cov=talor

# Code quality
black src/ tests/
ruff check src/ tests/
mypy src/
make check
```

### Frontend

```bash
cd talor-gui

# Testing
npm run test:run
npm run test:coverage

# Code quality
npm run format
npm run lint:fix
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/session` | List sessions |
| POST | `/api/session` | Create new session |
| GET | `/api/session/{id}` | Get session details |
| DELETE | `/api/session/{id}` | Delete session |
| POST | `/api/session/prompt` | Send message to Agent |
| GET | `/event?session_id={id}` | SSE event stream |
| GET | `/api/agent` | List agents |
| GET | `/api/provider` | List LLM providers |
| GET | `/api/config` | Get configuration |
| PUT | `/api/config` | Update configuration |

## Configuration

Edit `talor/config.yaml` to customize:

```yaml
# LLM Providers
providers:
  - name: openai
    api_key: sk-...
    models: [gpt-4o, gpt-4o-mini]

  - name: anthropic
    api_key: sk-ant-...
    models: [claude-3-5-sonnet-20241022]

  - name: ollama
    base_url: http://localhost:11434
    models: [llama3.1, qwen2.5-coder]

# Default Agent
default_agent: build
default_model: openai/gpt-4o

# Storage
storage:
  path: ~/.talor/data.db
```

## Privacy & Security

### What Stays Local

✅ All your files and data
✅ Conversation history
✅ Tool execution results
✅ Configuration and settings

### What Goes to LLM Providers

⚠️ Your messages and file contents you explicitly share
⚠️ Tool execution results (as context for the AI)

**Using local models?** With Ollama or similar, everything stays 100% on your machine.

### Security Notes

- Talor has full access to your file system (by design)
- Only run Talor in directories you trust
- Review tool executions in the UI before confirming (if using supervised mode)
- Don't expose the backend port (8000) to the internet

## Roadmap

### Near Term
- [ ] Native desktop app packaging (Electron/Tauri)
- [ ] System tray integration
- [ ] Global keyboard shortcuts
- [ ] More built-in tools (Docker, Kubernetes, database)
- [ ] Improved memory management

### Mid Term
- [ ] CLI mode (terminal-only interface)
- [ ] IDE extensions (VS Code, JetBrains)
- [ ] Agent collaboration (multiple agents working together)
- [ ] Workflow automation (scheduled tasks)
- [ ] Auto-update mechanism

### Long Term
- [ ] Voice input/output
- [ ] Visual UI for workflow building
- [ ] Plugin marketplace
- [ ] Cross-device sync (optional)
- [ ] Team collaboration features

## FAQ

**Q: Do I need an internet connection?**
A: Only if using cloud LLM providers (OpenAI, Anthropic). With Ollama, you can run 100% offline.

**Q: Can I use this for work projects?**
A: Yes! Talor is designed for developers. Just be mindful of what data you share with cloud LLMs.

**Q: How is this different from ChatGPT/Claude?**
A: Talor can execute tools on your machine (read/write files, run commands), has memory across sessions, and is fully customizable.

**Q: Can I add custom tools?**
A: Yes! Use the MCP (Model Context Protocol) to add custom tools without modifying Talor's code.

**Q: Is this production-ready?**
A: Talor is in active development. It's stable for personal use but expect breaking changes.

## License

Apache 2.0 with Commons Clause - see [LICENSE](LICENSE)

**TL;DR:**
- ✅ Free for personal and internal use
- ✅ Modify and distribute freely
- ✅ Use in your own products
- ❌ Can't sell Talor as a hosted service without permission

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues and questions, please open an issue on GitHub.
