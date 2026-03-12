/**
 * Task State Store
 * 任务状态 Store
 *
 * Manages background task state using Zustand, including task list,
 * current task, progress, and artifacts.
 */

import { create } from 'zustand';
import type { TaskApi, TaskArtifact, TaskInfo, TaskStatus } from '../api/task';

export type { TaskArtifact, TaskInfo, TaskStatus };

export interface TaskState {
  tasks: TaskInfo[];
  isCreating: boolean;
}

export interface TaskActions {
  fetchTasks(): Promise<void>;
  createTask(params: { title: string; agentId: string; prompt: string; useWorktree?: boolean }): Promise<TaskInfo>;
  cancelTask(taskId: string): Promise<void>;

  // SSE event-driven updates (called from useEvents)
  upsertTask(task: Partial<TaskInfo> & { id: string }): void;
  updateTaskStatus(taskId: string, status: TaskStatus, sessionId?: string): void;
  updateTaskProgress(taskId: string, progress: number, currentAction: string | null): void;
  addTaskArtifact(taskId: string, artifact: TaskArtifact): void;
  completeTask(taskId: string, result: string | null, artifactsCount: number): void;
  failTask(taskId: string, error: string): void;

  setApis(taskApi: TaskApi): void;
}

export type TaskStore = TaskState & TaskActions;

interface InternalState {
  _taskApi: TaskApi | null;
}

const initialState: TaskState = {
  tasks: [],
  isCreating: false,
};

export const useTaskStore = create<TaskStore & InternalState>((set, get) => ({
  ...initialState,
  _taskApi: null,

  setApis(taskApi: TaskApi): void {
    set({ _taskApi: taskApi });
  },

  async fetchTasks(): Promise<void> {
    const { _taskApi } = get();
    if (!_taskApi) return;
    try {
      const tasks = await _taskApi.list();
      set({ tasks });
    } catch {
      // Ignore fetch errors
    }
  },

  async createTask(params): Promise<TaskInfo> {
    const { _taskApi } = get();
    if (!_taskApi) throw new Error('Task API not initialized');

    set({ isCreating: true });
    try {
      const task = await _taskApi.create({
        title: params.title,
        agent_id: params.agentId,
        prompt: params.prompt,
        use_worktree: params.useWorktree,
      });
      set((state) => ({
        tasks: [task, ...state.tasks],
        isCreating: false,
      }));
      return task;
    } catch (error) {
      set({ isCreating: false });
      throw error;
    }
  },

  async cancelTask(taskId: string): Promise<void> {
    const { _taskApi } = get();
    if (!_taskApi) return;
    await _taskApi.cancel(taskId);
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, status: 'cancelled' as TaskStatus } : t
      ),
    }));
  },

  upsertTask(task: Partial<TaskInfo> & { id: string }): void {
    set((state) => {
      const existing = state.tasks.find((t) => t.id === task.id);
      if (existing) {
        return {
          tasks: state.tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t)),
        };
      }
      // New task — prepend to list
      const newTask: TaskInfo = {
        id: task.id,
        sessionId: task.sessionId ?? '',
        agentId: task.agentId ?? '',
        title: task.title ?? '',
        status: task.status ?? 'pending',
        progress: task.progress ?? 0,
        currentAction: task.currentAction ?? null,
        artifacts: task.artifacts ?? [],
        result: task.result ?? null,
        error: task.error ?? null,
        createdAt: task.createdAt ?? Date.now(),
        updatedAt: task.updatedAt ?? Date.now(),
        startedAt: task.startedAt ?? null,
        completedAt: task.completedAt ?? null,
      };
      return { tasks: [newTask, ...state.tasks] };
    });
  },

  updateTaskStatus(taskId: string, status: TaskStatus, _sessionId?: string): void {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, status, updatedAt: Date.now() } : t
      ),
    }));
  },

  updateTaskProgress(taskId: string, progress: number, currentAction: string | null): void {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, progress, currentAction, updatedAt: Date.now() } : t
      ),
    }));
  },

  addTaskArtifact(taskId: string, artifact: TaskArtifact): void {
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const exists = t.artifacts.some((a) => a.path === artifact.path);
        if (exists) {
          return { ...t, artifacts: t.artifacts.map((a) => (a.path === artifact.path ? artifact : a)) };
        }
        return { ...t, artifacts: [...t.artifacts, artifact], updatedAt: Date.now() };
      }),
    }));
  },

  completeTask(taskId: string, result: string | null, _artifactsCount: number): void {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? { ...t, status: 'completed' as TaskStatus, result, completedAt: Date.now(), updatedAt: Date.now() }
          : t
      ),
    }));
  },

  failTask(taskId: string, error: string): void {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? { ...t, status: 'failed' as TaskStatus, error, updatedAt: Date.now() }
          : t
      ),
    }));
  },
}));

export default useTaskStore;
