---
description: 定向修复指定文件的指定问题，不改其他任何文件
allowed-tools: Read, Write, Edit, Bash
argument-hint: <文件路径> <问题描述>
---

严格执行以下步骤，修复：$ARGUMENTS

1. 只读取涉及问题的相关文件
2. 在 Plan Mode 输出修复思路（不写代码）
3. 等待确认后，**只修改必要的代码行**，不重构无关部分
4. 运行对应测试验证：
   - 后端：`cd talor && pytest tests/<对应模块> -v`
   - 前端：`cd talor-gui && npm run test:run -- <对应文件>`
5. 运行类型检查：
   - 后端：`cd talor && make typecheck`
   - 前端：`cd talor-gui && npm run lint`
6. 输出改动 diff 摘要

⚠️ 约束：只允许修改问题所在文件，不得"顺手"改其他文件
