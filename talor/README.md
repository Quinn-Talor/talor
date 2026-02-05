# Talor - A ReAct-based AI Agent Framework

Talor is an event-driven AI agent framework built on the ReAct (Reasoning + Acting) architecture, designed for building intelligent agents that can interact with tools, manage sessions, and execute complex tasks.

## Features

0. **ReAct Architecture**: Iterative reasoning and acting loop for intelligent task execution
1. **Event-Driven Design**: Typed event system for modular communication
2. **Tool System**: Unified tool definitions with Pydantic validation
3. **Session Management**: Message-based conversation handling with isolation
4. **Multi-Provider Support**: Integration with multiple LLM providers via LiteLLM
5. **MCP Integration**: Model Context Protocol support for external tools
6. **Config System**: Layered configuration with keyring support
7. **Plugin System**: Extensible architecture for adding functionality

## Quick Start

### Installation

```bash
pip install talor
```

### Basic Usage

```python
import asyncio
from pathlib import Path
from src import initialize
from src.session import create_session
from src.agent import AgentExecutor

async def main():
    # Initialize the framework
    await initialize(workspace=Path("."))
    
    # Create a new session
    session = await create_session(title="My First Session")
    
    # Execute a task
    executor = AgentExecutor(workspace=Path("."))
    async for event in executor.execute_stream(
        session_id=session.id,
        parts=[{"type": "text", "text": "Hello! What can you do?"}],
        model={"provider_id": "openai", "model_id": "gpt-4"},
    ):
        print(event.type, event.data)

if __name__ == "__main__":
    asyncio.run(main())
```

## Architecture Overview

Talor follows a modular architecture with clear separation of concerns:

### Core Modules

- **src/bus**: Event system for inter-module communication
- **src/tool**: Tool definition and execution system
- **src/session**: Session and message management
- **src/agent**: ReAct execution engine and agent management
- **src/config**: Configuration management with keyring support
- **src/provider**: LLM provider abstraction layer
- **src/mcp_client**: Model Context Protocol integration

### Key Design Patterns

1. **Event-Driven Architecture**: All modules communicate through typed events
2. **Dependency Injection**: Modules are configured with required dependencies
3. **Interface Segregation**: Clear interfaces between components
4. **Separation of Concerns**: Each module has a single responsibility

## Development

### Project Structure

- `src/`: Core framework code
- `tests/`: Test suite
- `docs/`: Documentation
- `prompts/`: LLM prompts and system messages
- `talor.egg-info/`: Package metadata

### Testing

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=src
```

### Building

```bash
# Build package
python -m build
```

## Configuration

Talor supports layered configuration:

1. **Environment variables**
2. **Local config files** (JSON, YAML)
3. **Keyring integration** for secure secrets

Example config structure:

```json
{
  "api_key": "key_from_keyring",
  "workspace": [".", "/allowed/path"],
  "providers": {
    "openai": {
      "api_key": "key_from_keyring"
    }
  }
}
```

## API Reference

See the [documentation](docs/) for detailed API reference and examples.

## Contributing

Contributions are welcome! Please see the contributing guidelines for details.

## License

MIT License - see LICENSE file for details.