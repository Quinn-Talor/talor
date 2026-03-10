---
description: TDD 工作流：先写失败测试，再写最小实现，最后重构
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
argument-hint: <功能/模块描述>
---

使用 TDD 实现：$ARGUMENTS

**循环：写失败测试 → 最小实现 → 重构**

1. **分析测试位置**
   - 后端：`tests/<模块>/test_<名称>.py`（镜像 `src/` 结构）
   - 前端：`src/<模块>/<名称>.test.ts[x]`（与被测文件同目录）

2. **写失败测试**（不写实现代码）
   - 明确测试用例覆盖：正常路径、边界条件、错误情况
   - 后端异步：标注 `@pytest.mark.asyncio`
   - 前端组件：用 `render` + `userEvent`

3. **运行测试，确认失败**
   - 后端：`pytest tests/<文件> -v`
   - 前端：`npm run test:run -- <文件>`

4. **写最小实现**（只让测试通过，不多写）

5. **运行测试，确认通过**

6. **重构**（在测试绿灯下改善代码质量）

7. **类型检查**
   - 后端：`cd talor && make typecheck`
   - 前端：`cd talor-gui && npm run lint`

重复以上循环，直到功能完整。
