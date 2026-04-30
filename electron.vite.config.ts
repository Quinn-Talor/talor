import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const sharedAlias = {
  '@shared': resolve(__dirname, 'src/shared'),
}

// electron-vite 5 在 CJS 输出下 externalizeDepsPlugin 未能正确把 node_modules
// 标为 external —— 所有 deps(含 native addon 如 better-sqlite3、electron 本身)
// 都被打进 bundle,导致运行时找不到 native binding 文件。
// 从 package.json 读出 dependencies + peerDependencies 手动补 external 列表。
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')) as {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}
const externalDeps = [
  'electron',
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
]

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias },
    build: {
      // electron-vite 5 默认 main 产物是 ESM。Talor 源码里有 `__dirname`,
      // ESM 下需要替换为 `import.meta.dirname`(见 src/main/index.ts)。
      // externals 必须手动列出:CJS/ESM 输出下 externalizeDepsPlugin 行为
      // 不稳定,native 模块(better-sqlite3) / electron 入口若被打进 bundle
      // 会导致运行时找不到 binding。这里直接读 package.json 列出所有 deps。
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
        external: externalDeps,
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: sharedAlias },
    build: {
      // sandbox: true 的 webPreferences 要求 preload 以 CommonJS 加载。
      // 默认 electron-vite 产物是 .mjs,启动时会抛
      //   "Cannot use import statement outside a module"
      // 显式打成 .cjs 并关闭 minify 方便排查。
      // external: 与 main 同理,sandboxed preload 不能加载 node 模块(fs/path);
      // 把 electron 等包保持 require() 引用,由 Electron 运行时注入而不是打进 bundle。
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
        external: externalDeps,
      },
    },
  },
  renderer: {
    root: '.',
    resolve: { alias: sharedAlias },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
        },
      },
    },
    plugins: [react()],
  },
})
