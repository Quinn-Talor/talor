/**
 * Config, Provider, and MCP API Module Tests
 * 配置、提供商和 MCP API 模块测试
 *
 * Tests for the config, provider, and MCP API modules.
 * 配置、提供商和 MCP API 模块的测试。
 *
 * @requirements 6.1 - 设置配置
 * @requirements 7.1 - 模型选择
 * @requirements 8.1 - 工具状态显示
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TalorClient } from './client';
import { createConfigApi } from './config';
import { createProviderApi } from './provider';
import { createMCPApi } from './mcp';
import type { Config, ModelInfo, MCPServerInfo, Tool } from '../types/config';

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('Config API', () => {
  let client: TalorClient;

  beforeEach(() => {
    client = new TalorClient({ baseUrl: 'http://localhost:8000' });
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createConfigApi', () => {
    describe('get()', () => {
      it('should fetch configuration from GET /api/config', async () => {
        const mockConfig: Config = {
          theme: 'dark',
          language: 'zh',
          defaultModel: 'gpt-4',
          providers: [],
          mcpServers: [],
        };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockConfig,
        });

        const configApi = createConfigApi(client);
        const result = await configApi.get();

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8000/api/config',
          expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({
              'Content-Type': 'application/json',
            }),
          })
        );
        expect(result).toEqual(mockConfig);
      });

      it('should include auth token in request headers when set', async () => {
        const mockConfig: Config = { theme: 'light' };

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockConfig,
        });

        client.setAuthToken('test-token');
        const configApi = createConfigApi(client);
        await configApi.get();

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8000/api/config',
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'Bearer test-token',
            }),
          })
        );
      });

      it('should handle empty configuration', async () => {
        const mockConfig: Config = {};

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockConfig,
        });

        const configApi = createConfigApi(client);
        const result = await configApi.get();

        expect(result).toEqual({});
      });
    });

    describe('set()', () => {
      it('should update configuration via PUT /api/config', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 204,
          json: async () => undefined,
        });

        const configApi = createConfigApi(client);
        await configApi.set('theme', 'dark');

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8000/api/config',
          expect.objectContaining({
            method: 'PUT',
            headers: expect.objectContaining({
              'Content-Type': 'application/json',
            }),
            body: JSON.stringify({ key: 'theme', value: 'dark' }),
          })
        );
      });

      it('should handle setting complex values', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 204,
          json: async () => undefined,
        });

        const configApi = createConfigApi(client);
        const complexValue = {
          id: 'openai',
          name: 'OpenAI',
          apiKey: 'sk-xxx',
        };
        await configApi.set('providers', [complexValue]);

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8000/api/config',
          expect.objectContaining({
            body: JSON.stringify({ key: 'providers', value: [complexValue] }),
          })
        );
      });

      it('should handle setting null values', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 204,
          json: async () => undefined,
        });

        const configApi = createConfigApi(client);
        await configApi.set('defaultModel', null);

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8000/api/config',
          expect.objectContaining({
            body: JSON.stringify({ key: 'defaultModel', value: null }),
          })
        );
      });
    });
  });

  describe('createProviderApi', () => {
    describe('listModels()', () => {
      it('should fetch models from GET /api/provider/models', async () => {
        const mockModels: ModelInfo[] = [
          {
            id: 'gpt-4',
            name: 'GPT-4',
            providerId: 'openai',
            providerName: 'OpenAI',
            capabilities: ['chat', 'function_calling'],
          },
          {
            id: 'claude-3',
            name: 'Claude 3',
            providerId: 'anthropic',
            providerName: 'Anthropic',
            capabilities: ['chat'],
          },
        ];

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockModels,
        });

        const providerApi = createProviderApi(client);
        const result = await providerApi.listModels();

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8000/api/provider/models',
          expect.objectContaining({
            method: 'GET',
          })
        );
        expect(result).toEqual(mockModels);
        expect(result).toHaveLength(2);
      });

      it('should return empty array when no models available', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [],
        });

        const providerApi = createProviderApi(client);
        const result = await providerApi.listModels();

        expect(result).toEqual([]);
      });

      it('should include auth token in request headers when set', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [],
        });

        client.setAuthToken('provider-token');
        const providerApi = createProviderApi(client);
        await providerApi.listModels();

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8000/api/provider/models',
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'Bearer provider-token',
            }),
          })
        );
      });
    });
  });

  describe('createMCPApi', () => {
    describe('listServers()', () => {
      it('should fetch servers from GET /api/mcp/servers', async () => {
        const mockServers: MCPServerInfo[] = [
          {
            id: 'server-1',
            name: 'File System Server',
            command: 'npx',
            args: ['@modelcontextprotocol/server-filesystem'],
            env: {},
            transport: 'stdio',
            status: 'connected',
          },
          {
            id: 'server-2',
            name: 'Git Server',
            command: 'npx',
            args: ['@modelcontextprotocol/server-git'],
            env: {},
            transport: 'stdio',
            status: 'disconnected',
          },
        ];

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockServers,
        });

        const mcpApi = createMCPApi(client);
        const result = await mcpApi.listServers();

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8000/api/mcp/servers',
          expect.objectContaining({
            method: 'GET',
          })
        );
        expect(result).toEqual(mockServers);
        expect(result).toHaveLength(2);
      });

      it('should return empty array when no servers configured', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [],
        });

        const mcpApi = createMCPApi(client);
        const result = await mcpApi.listServers();

        expect(result).toEqual([]);
      });

      it('should handle servers with error status', async () => {
        const mockServers: MCPServerInfo[] = [
          {
            id: 'server-1',
            name: 'Broken Server',
            command: 'invalid-command',
            args: [],
            env: {},
            transport: 'stdio',
            status: 'error',
            error: 'Command not found',
          },
        ];

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockServers,
        });

        const mcpApi = createMCPApi(client);
        const result = await mcpApi.listServers();

        expect(result[0].status).toBe('error');
        expect(result[0].error).toBe('Command not found');
      });
    });

    describe('listTools()', () => {
      it('should fetch tools from GET /api/tools', async () => {
        const mockTools: Tool[] = [
          {
            name: 'read_file',
            description: 'Read contents of a file',
            inputSchema: {
              type: 'object',
              properties: {
                path: { type: 'string' },
              },
              required: ['path'],
            },
            serverId: 'server-1',
          },
          {
            name: 'write_file',
            description: 'Write contents to a file',
            inputSchema: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['path', 'content'],
            },
            serverId: 'server-1',
          },
        ];

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => mockTools,
        });

        const mcpApi = createMCPApi(client);
        const result = await mcpApi.listTools();

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8000/api/tools',
          expect.objectContaining({
            method: 'GET',
          })
        );
        expect(result).toEqual(mockTools);
        expect(result).toHaveLength(2);
      });

      it('should return empty array when no tools available', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [],
        });

        const mcpApi = createMCPApi(client);
        const result = await mcpApi.listTools();

        expect(result).toEqual([]);
      });

      it('should include auth token in request headers when set', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [],
        });

        client.setAuthToken('mcp-token');
        const mcpApi = createMCPApi(client);
        await mcpApi.listTools();

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8000/api/tools',
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: 'Bearer mcp-token',
            }),
          })
        );
      });
    });
  });
});
