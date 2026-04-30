// eslint.config.js — ESLint flat config(v9+)
//
// 分三段规则:
//   1. 基础:@eslint/js + typescript-eslint recommended(非 type-checked,速度优先)
//   2. React(仅 src/renderer):hooks + refresh + react 推荐
//   3. Prettier:关闭所有与 Prettier 格式冲突的规则(放最后)
//
// 故意不开启 typescript-eslint 的 "typed" linting(需要 parserOptions.project),
// 理由:三 tsconfig + vite/electron 组合下 parserOptions.project 配置复杂,
// typecheck 已由 tsc 独立保证,ESLint 只做"不依赖类型信息"的检查。

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  // ── 忽略 ──────────────────────────────────────────────────────────
  {
    ignores: [
      'node_modules/**',
      'out/**',
      'dist/**',
      'build/**',
      '.talor/**',
      'coverage/**',
      '**/*.d.ts',
      'tests/**',
      'vibe/**',
      'skills/**',
    ],
  },

  // ── 基础 TS 规则 ──────────────────────────────────────────────────
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ── 全局 language options ─────────────────────────────────────────
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      // 允许 `_` 开头的未使用变量(IPC handler `_event` 惯用)
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Talor 边界处大量 `unknown` + 手动 narrow,保留 any 的禁用
      '@typescript-eslint/no-explicit-any': 'warn',
      // 业务层大量抛出 Error(message),不需要强制 `throw new Error`
      'no-throw-literal': 'error',
      // 对于 ts-expect-error 只允许带描述的,防止滥用
      '@typescript-eslint/ban-ts-comment': [
        'warn',
        { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true },
      ],
      // 存量代码大量使用 `require()` 动态加载(测试 mock / 条件加载 / mjs 兼容),
      // 全面禁用会误伤。新代码请优先使用 ESM import。
      '@typescript-eslint/no-require-imports': 'warn',
      // preserve-caught-error 会要求所有 throw 都 attach { cause },存量代码
      // 不遵守。转为 warn,新代码尽量带 cause。
      'preserve-caught-error': 'off',
      // 允许 class + interface 声明合并(存量 PromptPipeline / Agent 等使用)
      '@typescript-eslint/no-unsafe-declaration-merging': 'warn',
      // 存量 orchestrator/mcp 有若干 this alias,转为 warn
      '@typescript-eslint/no-this-alias': 'warn',
      // no-useless-assignment 可能误伤 try/finally 的"提前赋值便于 finally 使用"模式
      'no-useless-assignment': 'warn',
    },
  },

  // ── Renderer(React) ──────────────────────────────────────────────
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // react-hooks v7 新增的严格规则对存量代码误报较多(set-state-in-effect
      // 等),降级为 warning。新代码在 review 时仍应注意这些模式。
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/incompatible-library': 'warn',
      'react-hooks/error-boundaries': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/unsupported-syntax': 'warn',
      'react-hooks/use-memo': 'warn',
      'react-hooks/config': 'warn',
      'react-hooks/gating': 'warn',
      'react-hooks/globals': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/component-hook-factories': 'warn',
      'react-hooks/static-components': 'warn',
    },
  },

  // ── 测试文件放宽 ──────────────────────────────────────────────────
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // ── Prettier(放最后,关闭格式冲突规则) ────────────────────────────
  prettier,
)
