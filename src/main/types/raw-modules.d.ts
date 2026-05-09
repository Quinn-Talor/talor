// src/main/types/raw-modules.d.ts — 基础设施层：Vite ?raw 导入的 TS 类型声明
//
// 让 `import x from './x.md?raw'` 在 main 进程的 TS 类型检查通过。
// Vite 编译期把内容内联为字符串。

declare module '*.md?raw' {
  const content: string
  export default content
}

declare module '*.txt?raw' {
  const content: string
  export default content
}
