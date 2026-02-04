# Talor

Talor is a universal AI Agent framework based on the ReAct (Reasoning + Acting) architecture, processing user requests through an iterative loop of reasoning, tool execution, and result observation.

## Core Features

- **ReAct Architecture** - Explicit reasoning-action-observation loop for intelligent handling of complex tasks
- **Multi-LLM Support** - Support for OpenAI, Anthropic, Ollama, and more via LiteLLM
- **MCP Integration** - Model Context Protocol for tool extension
- **Event-Driven** - Loosely coupled components and real-time communication via event bus
- **Plugin System** - Extensible prompt building plugins
- **Memory System** - Short-term and long-term memory management

## Project Structure

```
talor/          # Python backend - Agent core, API service, tools, memory, plugins
talor-gui/      # React frontend - Web interface for Agent interaction
```

## Quick Start

### Requirements

- Python 3.11+
- Node.js 18+

### Backend Setup

```bash
cd talor

# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install -e ".[dev]"

# Configure (copy example config and edit)
cp config.example.yaml config.yaml

# Start service
talor serve    # http://127.0.0.1:8000
```

### Frontend Setup

```bash
cd talor-gui

# Install dependencies
npm install

# Start development server
npm run dev    # http://localhost:5173
```

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

## Core Concepts

- **Session** - Conversation context containing messages and memory
- **Agent** - AI entity configured with model, permissions, and capabilities
- **Tool** - Executable operations (bash, file operations, etc.)
- **Plugin** - Builder that contributes to system prompts
- **Bus** - Event system for inter-component communication

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

## Architecture

### Plugin System

Talor uses a layered plugin system with priority-based prompt construction:

- **System Layer** (Priority 100) - ReAct framework and universal rules
- **Environment Layer** (Priority 200) - Environment information
- **LLM Layer** (Priority 300) - Model-specific configurations
- **Agent Layer** (Priority 400) - Agent roles and capabilities
- **Tool Layer** (Priority 500) - Tool definitions
- **Skill Layer** (Priority 600) - Skill-specific prompts
- **Memory Layer** (Priority 700) - Conversation history

### Built-in Agents

- **build** (Executor) - Main execution agent with full tool access
- **plan** (Planner) - Read-only planning agent for analysis and design
- **explore** (Explorer) - Quick exploration agent for information gathering
- **general** (General) - General research agent for complex reasoning

### Memory System

- Automatic summarization at 80% token threshold
- Preserves key nodes (tool calls, errors)
- Token budget control
- Sliding window mechanism

## License

Apache 2.0 with Commons Clause - see [LICENSE](LICENSE) file for details

### License Summary

- ✅ **Free for personal and internal use** - Use, modify, and distribute for personal projects and within your organization
- ✅ **Open source code** - Full source code available under Apache 2.0
- ✅ **Commercial use allowed** - Use in your own commercial products
- ❌ **SaaS/Cloud services require authorization** - Providing the software as a hosted service to third parties requires a commercial license

**Commons Clause Restriction**: You cannot provide Talor as a cloud service (SaaS) to third parties without a commercial license.

For commercial licensing inquiries, please contact: contact@talor.ai

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues and questions, please open an issue on GitHub.
