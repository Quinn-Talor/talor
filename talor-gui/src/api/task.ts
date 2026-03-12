/**
 * Task API Module
 * 任务 API 模块
 *
 * Provides task management API calls for background task execution.
 */

import type { TalorClient } from './client';

export type TaskStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskArtifact {
  path: string;
  type: string;
  updatedAt: number;
}

export interface TaskInfo {
  id: string;
  sessionId: string;
  agentId: string;
  title: string;
  status: TaskStatus;
  progress: number;
  currentAction: string | null;
  artifacts: TaskArtifact[];
  result: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface TaskStatusInfo {
  taskId: string;
  status: TaskStatus;
  progress: number;
  currentAction: string | null;
}

export interface CreateTaskRequest {
  title: string;
  agent_id: string;
  prompt: string;
  use_worktree?: boolean;
}

export interface WorkspaceInfo {
  task_id: string;
  worktree_path: string | null;
  artifacts: Array<{ path: string; type: string; updated_at: number }>;
  git_diff_stat: string | null;
}

export interface TaskApi {
  create(request: CreateTaskRequest): Promise<TaskInfo>;
  list(status?: TaskStatus): Promise<TaskInfo[]>;
  get(taskId: string): Promise<TaskInfo>;
  getStatus(taskId: string): Promise<TaskStatusInfo>;
  cancel(taskId: string): Promise<void>;
  getWorkspace(taskId: string): Promise<WorkspaceInfo>;
  previewFile(taskId: string, path: string): Promise<string>;
}

// Backend snake_case response
interface BackendTaskResponse {
  task_id: string;
  session_id: string;
  agent_id: string;
  title: string;
  status: TaskStatus;
  progress: number;
  current_action: string | null;
  artifacts: Array<{ path: string; type: string; updated_at: number }>;
  result: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
}

interface BackendTaskStatusResponse {
  task_id: string;
  status: TaskStatus;
  progress: number;
  current_action: string | null;
}

function toTaskInfo(r: BackendTaskResponse): TaskInfo {
  return {
    id: r.task_id,
    sessionId: r.session_id,
    agentId: r.agent_id,
    title: r.title,
    status: r.status,
    progress: r.progress,
    currentAction: r.current_action,
    artifacts: r.artifacts.map((a) => ({
      path: a.path,
      type: a.type,
      updatedAt: a.updated_at,
    })),
    result: r.result,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
  };
}

export function createTaskApi(client: TalorClient): TaskApi {
  return {
    async create(request: CreateTaskRequest): Promise<TaskInfo> {
      const response = await client.post<BackendTaskResponse>('/api/tasks', request);
      return toTaskInfo(response);
    },

    async list(status?: TaskStatus): Promise<TaskInfo[]> {
      let endpoint = '/api/tasks';
      if (status) {
        endpoint += `?status=${encodeURIComponent(status)}`;
      }
      const response = await client.get<BackendTaskResponse[]>(endpoint);
      return response.map(toTaskInfo);
    },

    async get(taskId: string): Promise<TaskInfo> {
      const response = await client.get<BackendTaskResponse>(`/api/tasks/${encodeURIComponent(taskId)}`);
      return toTaskInfo(response);
    },

    async getStatus(taskId: string): Promise<TaskStatusInfo> {
      const response = await client.get<BackendTaskStatusResponse>(
        `/api/tasks/${encodeURIComponent(taskId)}/status`
      );
      return {
        taskId: response.task_id,
        status: response.status,
        progress: response.progress,
        currentAction: response.current_action,
      };
    },

    async cancel(taskId: string): Promise<void> {
      await client.post<void>(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, {});
    },

    async getWorkspace(taskId: string): Promise<WorkspaceInfo> {
      return client.get<WorkspaceInfo>(`/api/tasks/${encodeURIComponent(taskId)}/workspace`);
    },

    async previewFile(taskId: string, path: string): Promise<string> {
      return client.get<string>(
        `/api/tasks/${encodeURIComponent(taskId)}/workspace/preview?path=${encodeURIComponent(path)}`
      );
    },
  };
}

export default createTaskApi;
