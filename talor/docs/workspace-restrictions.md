# 工作目录限制功能

## 概述

工作目录限制是一个安全功能，用于限制 Talor 的文件操作工具只能访问指定的目录。这可以防止意外或恶意的文件访问，保护系统文件和敏感数据。

## 功能特性

- ✅ 限制所有文件操作工具（read、write、edit、ls、grep、glob、bash）
- ✅ 支持多个工作目录白名单
- ✅ 清晰的错误提示
- ✅ 向后兼容（未配置时允许所有路径）
- ✅ 自动处理符号链接（解析后验证）

## 配置方法

### 1. 在配置文件中设置

编辑配置文件（`~/.talor/config.yaml` 或项目级 `.talor/config.yaml`）：

```yaml
# 工作目录限制
workspace:
  - "/Users/yourname/projects"
  - "/Users/yourname/Documents"
  # Windows 示例:
  # - "C:\\Users\\yourname\\projects"
```

### 2. 程序化配置

在应用初始化时配置：

```python
from pathlib import Path
from src import initialize
from src.core import workspace

# 初始化应用
await initialize(workspace=Path("."))

# 或者直接配置 workspace 模块
workspace.configure([
    Path("/Users/yourname/projects"),
    Path("/Users/yourname/Documents"),
])
```

## 工作原理

### 路径验证流程

1. 工具接收文件路径参数
2. 解析为绝对路径（处理相对路径和符号链接）
3. 检查是否在配置的工作目录内
4. 如果在范围内，继续执行；否则返回错误

### 受影响的工具

所有文件操作工具都会进行路径验证：

- **read**: 读取文件内容
- **write**: 写入文件内容
- **edit**: 编辑文件（字符串替换）
- **ls**: 列出目录内容
- **grep**: 搜索文件内容
- **glob**: 查找匹配文件
- **bash**: 限制工作目录（cwd）

### 错误提示

当尝试访问工作目录外的文件时，会收到清晰的错误提示：

```
Access denied: /tmp/secret.txt is outside the workspace directory.
Allowed workspaces: /Users/yourname/projects, /Users/yourname/Documents
```

## 使用示例

### 示例 1: 单个工作目录

```yaml
workspace:
  - "/Users/yourname/myproject"
```

- ✅ 允许: `/Users/yourname/myproject/src/main.py`
- ✅ 允许: `/Users/yourname/myproject/docs/README.md`
- ❌ 拒绝: `/Users/yourname/other/file.txt`
- ❌ 拒绝: `/tmp/temp.txt`

### 示例 2: 多个工作目录

```yaml
workspace:
  - "/Users/yourname/project1"
  - "/Users/yourname/project2"
```

- ✅ 允许: `/Users/yourname/project1/file.txt`
- ✅ 允许: `/Users/yourname/project2/file.txt`
- ❌ 拒绝: `/Users/yourname/project3/file.txt`

### 示例 3: 未配置（向后兼容）

如果不配置 `workspace` 字段，所有路径都被允许：

```yaml
# 没有 workspace 配置
```

- ✅ 允许: 任何路径

## 安全建议

1. **始终配置工作目录**: 在生产环境中，始终配置工作目录限制
2. **最小权限原则**: 只添加必要的工作目录
3. **定期审查**: 定期检查配置的工作目录是否仍然需要
4. **避免根目录**: 不要将 `/` 或 `C:\` 设置为工作目录
5. **测试配置**: 在应用配置后测试工具是否按预期工作

## 常见问题

### Q: 如何临时禁用工作目录限制？

A: 从配置文件中删除或注释掉 `workspace` 字段，然后重启应用。

### Q: 符号链接如何处理？

A: 符号链接会被解析为实际路径，然后验证实际路径是否在工作目录内。

### Q: 相对路径如何处理？

A: 相对路径会相对于工具的 worktree 解析为绝对路径，然后进行验证。

### Q: 如果我需要访问工作目录外的文件怎么办？

A: 将该目录添加到 `workspace` 配置中，或者临时禁用工作目录限制。

### Q: 这会影响性能吗？

A: 路径验证的性能开销非常小（仅涉及路径解析和字符串比较），不会明显影响工具执行速度。

## 技术实现

### 核心模块

- **模块**: `src/core/workspace.py`
- **测试**: `tests/core/test_workspace.py`, `tests/core/test_workspace_integration.py`

### API

```python
from src.core import workspace

# 配置工作目录
workspace.configure([Path("/path/to/workspace")])

# 获取配置的工作目录
workspaces = workspace.get_workspaces()

# 检查路径是否允许
is_allowed = workspace.is_path_allowed("/path/to/file")

# 验证路径（如果不允许会抛出 PermissionError）
validated_path = workspace.validate_path("/path/to/file")

# 批量验证
validated_paths = workspace.validate_paths(["/path1", "/path2"])
```

## 更新日志

### v0.1.0 (2026-02-05)

- ✨ 新增工作目录限制功能
- ✨ 支持多个工作目录白名单
- ✨ 集成到所有文件操作工具
- ✨ 向后兼容（未配置时允许所有路径）
- ✅ 完整的单元测试和集成测试覆盖
