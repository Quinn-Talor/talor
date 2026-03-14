import type { TalorAPI } from '../preload/index'

declare global {
  interface Window {
    api: TalorAPI
  }
}

export {}
