// 隔离启动：主目录 / userData 指向临时目录，再加载构建产物（不改源码）。
// 由 scripts/e2e/e2e.mjs 通过 Electron 二进制启动；环境变量 TALOR_ISO_HOME、TALOR_MAIN_ENTRY 由它设置。
import { app } from 'electron'

const iso = process.env.TALOR_ISO_HOME
if (!iso || !process.env.TALOR_MAIN_ENTRY)
  throw new Error('需要 TALOR_ISO_HOME 与 TALOR_MAIN_ENTRY')
app.setPath('home', iso)
app.setPath('userData', iso + '/userData')
await import(process.env.TALOR_MAIN_ENTRY)
