---
description: 审查当前分支相对 main 的所有改动
allowed-tools: Read, Bash, Grep
---

对当前分支相对于 main 的改动进行代码审查：

1. 运行 `git diff main...HEAD --name-only` 列出改动文件
2. 运行 `git diff main...HEAD` 查看详细差异
3. 逐文件审查，只关注：
   - 🔴 Bug 或逻辑错误（必须修复）
   - 🟡 安全漏洞（必须修复）
   - 🟢 性能问题（建议优化）
4. 不评论代码风格，linter 会处理
5. 按文件输出审查结论，无问题则标注 ✅
