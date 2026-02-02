/**
 * Talor API Client Base Class
 * Talor API 客户端基础类
 *
 * Provides HTTP request handling, authentication, and error handling
 * for communication with the Talor backend.
 *
 * @requirements 1.1 - HTTP 连接到 Talor_Backend 的 REST API
 * @requirements 1.5 - 包含必要的认证信息
 */

/**
 * Network error class for API request failures
 * API 请求失败的网络错误类
 */
export class NetworkError extends Error {
  readonly statusCode?: number;
  readonly response?: unknown;

  constructor(
    message: string,
    statusCode?: number,
    response?: unknown
  ) {
    super(message);
    this.name = 'NetworkError';
    this.statusCode = statusCode;
    this.response = response;
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/**
 * Authentication error for 401 responses
 * 401 响应的认证错误
 */
export class AuthenticationError extends NetworkError {
  constructor(message: string = '认证失败，请重新登录') {
    super(message, 401);
    this.name = 'AuthenticationError';
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

/**
 * Not found error for 404 responses
 * 404 响应的资源不存在错误
 */
export class NotFoundError extends NetworkError {
  constructor(message: string = '请求的资源不存在') {
    super(message, 404);
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Server error for 5xx responses
 * 5xx 响应的服务器错误
 */
export class ServerError extends NetworkError {
  constructor(message: string = '服务器错误，请稍后重试', statusCode: number = 500) {
    super(message, statusCode);
    this.name = 'ServerError';
    Object.setPrototypeOf(this, ServerError.prototype);
  }
}

/**
 * Configuration options for TalorClient
 * TalorClient 的配置选项
 */
export interface TalorClientConfig {
  /** Base URL of the Talor backend API / Talor 后端 API 的基础 URL */
  baseUrl: string;
  /** Request timeout in milliseconds (default: 30000) / 请求超时时间（毫秒，默认30000） */
  timeout?: number;
  /** Global error handler callback / 全局错误处理回调 */
  onError?: (error: Error) => void;
}

/**
 * HTTP request options
 * HTTP 请求选项
 */
interface RequestOptions {
  /** HTTP method / HTTP 方法 */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Request headers / 请求头 */
  headers?: Record<string, string>;
  /** Request body / 请求体 */
  body?: unknown;
  /** Request timeout override / 请求超时覆盖 */
  timeout?: number;
}

/**
 * Default timeout in milliseconds
 * 默认超时时间（毫秒）
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * Talor API Client base class
 * Talor API 客户端基础类
 *
 * Handles HTTP communication with the Talor backend including:
 * - Request/response handling
 * - Authentication header injection
 * - Error handling and transformation
 */
export class TalorClient {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly onError?: (error: Error) => void;
  private authToken: string | null = null;

  /**
   * Creates a new TalorClient instance
   * 创建新的 TalorClient 实例
   *
   * @param config - Client configuration / 客户端配置
   */
  constructor(config: TalorClientConfig) {
    // Remove trailing slash from baseUrl for consistent URL construction
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.onError = config.onError;
  }

  /**
   * Sets the authentication token for API requests
   * 设置 API 请求的认证令牌
   *
   * @param token - Authentication token or null to clear / 认证令牌或 null 清除
   */
  public setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  /**
   * Gets the current authentication token
   * 获取当前的认证令牌
   *
   * @returns Current auth token or null / 当前认证令牌或 null
   */
  public getAuthToken(): string | null {
    return this.authToken;
  }

  /**
   * Builds request headers including authentication
   * 构建请求头，包含认证信息
   *
   * @param customHeaders - Additional headers to include / 要包含的额外头
   * @returns Complete headers object / 完整的头对象
   */
  private buildHeaders(customHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...customHeaders,
    };

    // Inject authentication header if token is set
    // 如果设置了令牌，注入认证头
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    return headers;
  }

  /**
   * Handles API errors and transforms them to appropriate error types
   * 处理 API 错误并转换为适当的错误类型
   *
   * @param error - The error to handle / 要处理的错误
   * @throws Transformed error / 转换后的错误
   */
  private handleError(error: unknown): never {
    // Call global error handler if configured
    if (this.onError && error instanceof Error) {
      this.onError(error);
    }

    if (error instanceof NetworkError) {
      // Transform to specific error types based on status code
      if (error.statusCode === 401) {
        throw new AuthenticationError();
      }
      if (error.statusCode === 404) {
        throw new NotFoundError();
      }
      if (error.statusCode && error.statusCode >= 500) {
        throw new ServerError('服务器错误，请稍后重试', error.statusCode);
      }
      throw error;
    }

    // Wrap unknown errors
    if (error instanceof Error) {
      throw new NetworkError(error.message);
    }

    throw new NetworkError('未知错误');
  }

  /**
   * Makes an HTTP request to the API
   * 向 API 发起 HTTP 请求
   *
   * @param endpoint - API endpoint path / API 端点路径
   * @param options - Request options / 请求选项
   * @returns Parsed response data / 解析后的响应数据
   * @throws NetworkError on request failure / 请求失败时抛出 NetworkError
   */
  private async request<T>(endpoint: string, options: RequestOptions): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const timeout = options.timeout ?? this.timeout;

    // Create abort controller for timeout handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const fetchOptions: RequestInit = {
        method: options.method,
        headers: this.buildHeaders(options.headers),
        signal: controller.signal,
      };

      // Add body for non-GET requests
      if (options.body !== undefined && options.method !== 'GET') {
        fetchOptions.body = JSON.stringify(options.body);
      }

      const response = await fetch(url, fetchOptions);

      // Handle non-OK responses
      if (!response.ok) {
        let responseBody: unknown;
        try {
          responseBody = await response.json();
        } catch {
          responseBody = await response.text();
        }

        throw new NetworkError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          responseBody
        );
      }

      // Handle empty responses (204 No Content)
      if (response.status === 204) {
        return undefined as T;
      }

      // Parse JSON response
      const data = await response.json();
      return data as T;
    } catch (error) {
      // Handle abort (timeout)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new NetworkError(`请求超时 (${timeout}ms)`, undefined, undefined);
      }

      // Handle fetch errors (network issues)
      if (error instanceof TypeError) {
        throw new NetworkError(`网络错误: ${error.message}`, undefined, undefined);
      }

      // Re-throw NetworkError as-is, handle others
      if (error instanceof NetworkError) {
        this.handleError(error);
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Makes a GET request
   * 发起 GET 请求
   *
   * @param endpoint - API endpoint path / API 端点路径
   * @param options - Optional request options / 可选的请求选项
   * @returns Response data / 响应数据
   */
  public async get<T>(
    endpoint: string,
    options?: { headers?: Record<string, string>; timeout?: number }
  ): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'GET',
      ...options,
    });
  }

  /**
   * Makes a POST request
   * 发起 POST 请求
   *
   * @param endpoint - API endpoint path / API 端点路径
   * @param body - Request body / 请求体
   * @param options - Optional request options / 可选的请求选项
   * @returns Response data / 响应数据
   */
  public async post<T>(
    endpoint: string,
    body?: unknown,
    options?: { headers?: Record<string, string>; timeout?: number }
  ): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body,
      ...options,
    });
  }

  /**
   * Makes a PUT request
   * 发起 PUT 请求
   *
   * @param endpoint - API endpoint path / API 端点路径
   * @param body - Request body / 请求体
   * @param options - Optional request options / 可选的请求选项
   * @returns Response data / 响应数据
   */
  public async put<T>(
    endpoint: string,
    body?: unknown,
    options?: { headers?: Record<string, string>; timeout?: number }
  ): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body,
      ...options,
    });
  }

  /**
   * Makes a DELETE request
   * 发起 DELETE 请求
   *
   * @param endpoint - API endpoint path / API 端点路径
   * @param options - Optional request options / 可选的请求选项
   * @returns Response data / 响应数据
   */
  public async delete<T>(
    endpoint: string,
    options?: { headers?: Record<string, string>; timeout?: number }
  ): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'DELETE',
      ...options,
    });
  }

  /**
   * Gets the base URL of the client
   * 获取客户端的基础 URL
   *
   * @returns Base URL / 基础 URL
   */
  public getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Gets the configured timeout
   * 获取配置的超时时间
   *
   * @returns Timeout in milliseconds / 超时时间（毫秒）
   */
  public getTimeout(): number {
    return this.timeout;
  }
}

/**
 * Default export for convenience
 * 默认导出以方便使用
 */
export default TalorClient;
