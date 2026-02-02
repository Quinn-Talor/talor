# Talor 架构优化文档

## 概述

Talor 是一个基于 ReAct (Reasoning + Acting) 模式的通用 AI Agent。本文档记录了架构优化的设计和实现。

## ReAct 架构

### 核心循环

ReAct 模式将 Agent 的执行分为三个明确的阶段：

```
┌─────────────────────────────────────────────────────────────┐
│                    ReAct Loop                                │
│                                                              │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐             │
│   │ Reasoning│───▶│  Action  │───▶│Observation│────┐        │
│   │ (思考)   │    │  (行动)  │    │  (观察)   │    │        │
│   └──────────┘    └──────────┘    └──────────┘    │        │
│        ▲                                          │        │
│        └──────────────────────────────────────────┘        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

1. **Reasoning (推理)**: LLM 分析上下文，决定下一步行动
2. **Action (行动)**: 执行工具调用
3. **Observation (观察)**: 处理工具结果，更新上下文

### 模块结构

```
talor/src/
├── agent/
│   ├── __init__.py      # 导出 Agent, AgentLoop 等
│   ├── agent.py         # Agent 配置和管理
│   ├── loop.py          # ReAct 核心循环 ⭐ 新增
│   └── permission.py    # 权限系统
├── memory/              # ⭐ 新增：记忆系统
│   ├── __init__.py
│   ├── short_term.py    # 短期记忆（会话内）
│   └── context.py       # 记忆上下文管理
├── bus/
│   ├── events.py        # 事件定义（含 ReAct 事件）
│   └── bus.py           # 事件总线
└── ...
```

## 核心组件

### 1. AgentLoop (`agent/loop.py`)

核心 ReAct 循环实现：

```python
from talor.agent import AgentLoop, LoopConfig

# 创建循环
loop = AgentLoop(
    session_id="session_123",
    message_id="msg_456",
    agent=agent_info,
    provider=provider,
    tool_registry=registry,
    config=LoopConfig(
        max_iterations=50,
        enable_reflection=True,
        reflection_frequency=5,
    ),
)

# 运行循环
async for event in loop.run("帮我重构这段代码"):
    if event["type"] == "agent.thought":
        print(f"思考: {event['properties']['content']}")
    elif event["type"] == "agent.action":
        print(f"行动: {event['properties']['tool']}")
    elif event["type"] == "agent.observation":
        print(f"观察: {event['properties']['output'][:100]}")
```

#### 关键数据结构

| 类 | 描述 |
|---|---|
| `Thought` | LLM 的推理输出，包含内容和工具调用决策 |
| `ToolCall` | 工具调用请求 |
| `Action` | 执行中的动作 |
| `Observation` | 工具执行结果 |
| `LoopContext` | 循环执行上下文 |
| `LoopConfig` | 循环配置 |

#### 循环阶段

```python
class LoopPhase(str, Enum):
    IDLE = "idle"           # 空闲
    REASONING = "reasoning" # 推理中
    ACTING = "acting"       # 执行中
    OBSERVING = "observing" # 观察中
    COMPLETED = "completed" # 完成
    ERROR = "error"         # 错误
```

#### 停止原因

```python
class StopReason(str, Enum):
    COMPLETED = "completed"          # 自然完成
    MAX_ITERATIONS = "max_iterations" # 达到迭代上限
    CANCELLED = "cancelled"          # 用户取消
    ERROR = "error"                  # 发生错误
    NO_ACTION = "no_action"          # LLM 决定无需行动
```

### 2. 记忆系统 (`memory/`)

#### ShortTermMemory

管理会话内的短期记忆：

```python
from talor.memory import ShortTermMemory

memory = ShortTermMemory(
    session_id="session_123",
    max_messages=50,
    max_tokens=32000,
)

# 设置系统提示
memory.set_system_message("You are a helpful assistant.")

# 添加消息
memory.add_user_message("Hello")
memory.add_assistant_message("Hi there!")
memory.add_tool_result("call_1", "File content")

# 获取 LLM 上下文
messages = memory.get_messages(max_tokens=8000)
```

特性：
- 滑动窗口消息管理
- Token 感知的上下文截断
- 工具调用追踪
- 对话摘要支持

#### MemoryContext

统一的记忆上下文管理：

```python
from talor.memory import MemoryContext

ctx = MemoryContext(session_id="session_123")
ctx.set_system_prompt("You are helpful.")

# 构建 LLM 上下文
messages = ctx.build_context(
    user_prompt="Help me with this",
    max_tokens=8000,
)
```

### 3. 事件系统扩展

新增 ReAct 相关事件：

| 事件 | 描述 |
|---|---|
| `agent.loop.started` | 循环开始 |
| `agent.loop.phase` | 阶段变化 |
| `agent.thought` | 推理输出 |
| `agent.action` | 工具调用 |
| `agent.observation` | 工具结果 |
| `agent.reflection` | 自我反思 |
| `agent.loop.completed` | 循环完成 |
| `agent.loop.error` | 循环错误 |

## 配置

### LoopConfig

```python
@dataclass
class LoopConfig:
    max_iterations: int = 50           # 最大迭代次数
    max_tool_calls_per_iteration: int = 10  # 每次迭代最大工具调用
    timeout_seconds: float = 300       # 总超时时间
    enable_reflection: bool = False    # 启用自我反思
    reflection_frequency: int = 5      # 反思频率
    retry_on_error: bool = True        # 错误重试
    max_retries: int = 2               # 最大重试次数
```

### YAML 配置

```yaml
# config.yaml
agent:
  default:
    max_iterations: 50
    reasoning_strategy: "chain_of_thought"
    memory:
      short_term_limit: 50
      max_tokens: 32000
    reflection:
      enabled: true
      frequency: 5
```

## 使用示例

### 基本使用

```python
from talor.agent import Agent, AgentLoop, LoopConfig
from talor.provider import Provider
from talor.tool import ToolRegistry

# 获取 Agent
agent = await Agent.get("build")

# 创建循环
loop = AgentLoop(
    session_id="session_123",
    message_id="msg_456",
    agent=agent,
    provider=Provider,
    tool_registry=registry,
)

# 执行
async for event in loop.run("帮我分析这个代码库"):
    print(event)
```

### 带反思的执行

```python
config = LoopConfig(
    max_iterations=30,
    enable_reflection=True,
    reflection_frequency=5,
)

loop = AgentLoop(
    session_id="session_123",
    message_id="msg_456",
    agent=agent,
    provider=Provider,
    tool_registry=registry,
    config=config,
)

async for event in loop.run("重构这个模块"):
    if event["type"] == "agent.reflection":
        print(f"反思: 成功率 {event['properties']['success_rate']:.1%}")
```

### 中断执行

```python
import asyncio

loop = AgentLoop(...)

async def run_with_timeout():
    async for event in loop.run("长任务"):
        if should_stop():
            loop.abort()
            break
        yield event
```

## 架构优势

1. **显式循环抽象**: ReAct 循环的三个阶段清晰分离
2. **可观测性**: 丰富的事件系统支持监控和调试
3. **可配置性**: 灵活的配置支持不同场景
4. **记忆管理**: 智能的上下文管理避免 token 溢出
5. **错误恢复**: 内置重试和错误处理机制
6. **可扩展性**: 易于添加新的推理策略和记忆类型

## 未来扩展

### 计划中的功能

1. **长期记忆**: 跨会话的知识存储和检索
2. **高级推理策略**: Tree of Thought, Self-Consistency 等
3. **多 Agent 协作**: Agent 间的通信和任务分配
4. **学习能力**: 从历史执行中学习优化策略

### 扩展点

- `memory/long_term.py`: 长期记忆实现
- `reasoning/`: 高级推理策略
- `agent/multi_agent.py`: 多 Agent 协调
