/**
 * Hooks Module Index
 * Hooks 模块索引
 *
 * Exports all custom React hooks for the Talor GUI application.
 */

// Event handling hook
export {
  useEvents,
  createEventHandler,
  extractSessionEventData,
  extractMessageEventData,
  extractPermissionRequestEventData,
  extractMCPServerEventData,
  type EventHandlers,
  type StoreCallbacks,
  type UseEventsOptions,
  type UseEventsReturn,
} from './useEvents';
