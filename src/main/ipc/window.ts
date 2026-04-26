// src/main/ipc/window.ts —— 入口层：窗口管理 IPC handlers
// 允许依赖：shared/*

import { ipcMain, BrowserWindow } from 'electron'

let _mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow): void {
  _mainWindow = win
}

export function getMainWindow(): BrowserWindow | null {
  return _mainWindow
}

export function registerWindowHandlers(): void {
  ipcMain.on('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
  })

  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })

  ipcMain.on('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.close()
  })

  ipcMain.handle('window:isMaximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isMaximized() ?? false
  })
}
