---
description: 新功能标准开发流程（先调研计划，等确认后再实现）
allowed-tools: Read, Bash, Glob, Grep
argument-hint: <功能描述>
---

启动新功能：$ARGUMENTS

**阶段 1 — 只调研，不写代码：**

1. 搜索现有相关代码，理解当前模式（Glob + Grep）
2. 阅读 `talor/CLAUDE.md` 或 `talor-gui/CLAUDE.md` 确认架构边界
3. 识别需要修改/创建的文件列表
4. 输出完整的技术方案：
   - 涉及哪些文件，每个文件改什么
   - 是否需要新增测试文件
   - 是否涉及数据库字段变更（需单独迁移）
5. 等待确认 ✋

**阶段 2 — 确认后才开始：**

6. 先写测试文件（TDD：测试先行）
7. 按方案逐文件实现
8. 每完成一个文件，运行一次类型检查：
   - 后端：`cd talor && make typecheck`
   - 前端：`cd talor-gui && npm run lint`
9. 最终运行完整测试套件：
   - 后端：`cd talor && make test`
   - 前端：`cd talor-gui && npm run test:run`
