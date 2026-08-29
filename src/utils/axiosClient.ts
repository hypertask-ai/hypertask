import axios, {
    AxiosError,
    AxiosInstance,
    AxiosRequestConfig,
    AxiosResponse,
    InternalAxiosRequestConfig,
    AxiosResponseHeaders,
    RawAxiosResponseHeaders,
    CancelTokenSource,
  } from 'axios';
  
  /**
   * Extended Axios request configuration to include timing metadata.
   */
  export interface EnhancedRequestConfig extends InternalAxiosRequestConfig {
    metadata?: {
      startTime?: number;
      endTime?: number;
      duration?: number;
    };
  }
  
  /**
   * Standardized response format returned by ApiClient methods.
   *
   * @template T The type of the `data` field.
   */
  export interface ApiResponse<T = any> {
    data: T;
    status: number;
    statusText: string;
    headers: AxiosResponseHeaders | RawAxiosResponseHeaders;
    config: EnhancedRequestConfig;
    duration?: number;
  }
  
  /**
   * Standardized error format returned from ApiClient methods on failure.
   *
   * @template T The type of the error `response` data.
   */
  export interface ApiError<T = any> extends AxiosError<T> {
    duration?: number;
  }
  
  const pendingRequests = new Map<string, CancelTokenSource>();
  
  /**
   * Creates a unique key for the request using its method, URL, params, and body.
   *
   * @param config - The Axios request configuration.
   * @returns A unique string identifying the request.
   */
  const getRequestKey = (config: InternalAxiosRequestConfig): string => {
    const { url, method, params, data } = config;
    return `${method || 'GET'}-${url}-${JSON.stringify(params || {})}-${JSON.stringify(data || {})}`;
  };
  
  /**
   * Axios wrapper client with enhanced request handling, including:
   * - Request/response timing metadata
   * - Request cancellation
   * - Type-safe methods for HTTP verbs
   * - Manual interceptor management
   *
   * @example
   * const api = new ApiClient();
   * const users = await api.get<User[]>('/users');
   */
  class ApiClient {
    private instance: AxiosInstance;
  
    private defaultOptions: AxiosRequestConfig = {
      baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || '/api',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    };
  
    /**
     * Constructs an ApiClient instance.
     *
     * @param options - Optional default Axios configuration.
     */
    constructor(options: AxiosRequestConfig = {}) {
      this.instance = axios.create({
        ...this.defaultOptions,
        ...options,
      });
  
      this.setupInterceptors();
    }
  
    /**
     * Sets up request and response interceptors.
     * Tracks duration, handles cancellation, and stores metadata.
     */
    private setupInterceptors(): void {
      this.instance.interceptors.request.use(
        (config: InternalAxiosRequestConfig) => {
          const enhancedConfig = config as EnhancedRequestConfig;
          enhancedConfig.metadata = { startTime: Date.now() };
  
          const source = axios.CancelToken.source();
          enhancedConfig.cancelToken = source.token;
  
          const requestKey = getRequestKey(enhancedConfig);
          pendingRequests.set(requestKey, source);
  
          return enhancedConfig;
        },
        (error: AxiosError) => Promise.reject(error)
      );
  
      this.instance.interceptors.response.use(
        (response: AxiosResponse) => {
          const config = response.config as EnhancedRequestConfig;
          if (config.metadata) {
            config.metadata.endTime = Date.now();
            config.metadata.duration = config.metadata.endTime - (config.metadata.startTime || 0);
          }
  
          const requestKey = getRequestKey(config);
          pendingRequests.delete(requestKey);
  
          const enhancedResponse = response as AxiosResponse & { duration?: number };
          enhancedResponse.duration = config.metadata?.duration;
  
          return enhancedResponse;
        },
        (error: AxiosError) => {
          // HTPR-4182: stale session (nookies_user without a valid ht_session) -> clean re-login
          const responseData = error.response?.data as { code?: string } | undefined;
          if (typeof window !== 'undefined'
              && error.response?.status === 401
              && responseData?.code === 'SESSION_REQUIRED'
              && !window.location.pathname.startsWith('/login')) {
            try { document.cookie = 'nookies_user=; Max-Age=0; path=/'; } catch {}
            window.location.assign('/login');
          }

          const config = error.config as EnhancedRequestConfig | undefined;
          if (config?.metadata) {
            config.metadata.endTime = Date.now();
            config.metadata.duration = config.metadata.endTime - (config.metadata.startTime || 0);
          }
  
          const requestKey = config ? getRequestKey(config) : '';
          if (requestKey) pendingRequests.delete(requestKey);
  
          const apiError = error as ApiError;
          if (config?.metadata?.duration) {
            apiError.duration = config.metadata.duration;
          }
  
          return Promise.reject(apiError);
        }
      );
    }
  
    /**
     * Cancels a request using its configuration.
     *
     * @param config - The Axios request configuration used to identify the request.
     * @returns Whether the request was found and cancelled.
     */
    public cancelRequest(config: InternalAxiosRequestConfig): boolean {
      const requestKey = getRequestKey(config);
      const source = pendingRequests.get(requestKey);
  
      if (source) {
        source.cancel(`Request canceled by user: ${requestKey}`);
        pendingRequests.delete(requestKey);
        return true;
      }
  
      return false;
    }
  
    /**
     * Cancels all ongoing requests.
     *
     * @param reason - Optional cancellation reason.
     */
    public cancelAllRequests(reason: string = 'Operation canceled by user'): void {
      pendingRequests.forEach((source) => source.cancel(reason));
      pendingRequests.clear();
    }
  
    /**
     * Cancels requests matching a specific URL pattern.
     *
     * @param urlPattern - Regular expression to match request keys.
     * @param reason - Optional cancellation reason.
     * @returns Number of requests cancelled.
     */
    public cancelRequestsMatching(urlPattern: RegExp, reason: string = 'Operation canceled by user'): number {
      let cancelCount = 0;
  
      pendingRequests.forEach((source, key) => {
        if (key.match(urlPattern)) {
          source.cancel(reason);
          pendingRequests.delete(key);
          cancelCount++;
        }
      });
  
      return cancelCount;
    }
  
    /**
     * Performs a generic Axios request.
     *
     * @template T - Type of the expected response data.
     * @param config - Axios request config.
     * @returns The full ApiResponse object.
     */
    public async request<T = any>(config: AxiosRequestConfig): Promise<ApiResponse<T>> {
      const response = await this.instance.request<T>(config);
      return response as unknown as ApiResponse<T>;
    }
  
    /**
     * Sends a GET request.
     *
     * @template T - Type of the expected response data.
     * @param url - URL path.
     * @param config - Optional Axios config.
     * @returns ApiResponse containing `data` and metadata.
     *
     * @example
     * const res = await api.get<User[]>('/users');
     */
    public async get<T = any>(url: string, config: AxiosRequestConfig = {}): Promise<ApiResponse<T>> {
      const response = await this.instance.get<T>(url, config);
      return response as unknown as ApiResponse<T>;
    }
  
    /**
     * Sends a POST request.
     *
     * @template T - Type of the expected response data.
     * @template D - Type of the request payload.
     * @param url - URL path.
     * @param data - Request body.
     * @param config - Optional Axios config.
     * @returns ApiResponse
     */
    public async post<T = any, D = any>(url: string, data?: D, config: AxiosRequestConfig = {}): Promise<ApiResponse<T>> {
      const response = await this.instance.post<T>(url, data, config);
      return response as unknown as ApiResponse<T>;
    }
  
    /**
     * Sends a PUT request.
     */
    public async put<T = any, D = any>(url: string, data?: D, config: AxiosRequestConfig = {}): Promise<ApiResponse<T>> {
      const response = await this.instance.put<T>(url, data, config);
      return response as unknown as ApiResponse<T>;
    }
  
    /**
     * Sends a PATCH request.
     */
    public async patch<T = any, D = any>(url: string, data?: D, config: AxiosRequestConfig = {}): Promise<ApiResponse<T>> {
      const response = await this.instance.patch<T>(url, data, config);
      return response as unknown as ApiResponse<T>;
    }
  
    /**
     * Sends a DELETE request.
     */
    public async delete<T = any>(url: string, config: AxiosRequestConfig = {}): Promise<ApiResponse<T>> {
      const response = await this.instance.delete<T>(url, config);
      return response as unknown as ApiResponse<T>;
    }
  
    /**
     * Returns the raw Axios instance for advanced usage.
     */
    public getAxiosInstance(): AxiosInstance {
      return this.instance;
    }
  
    /**
     * Adds a custom request interceptor.
     *
     * @returns Interceptor ID for potential removal.
     */
    public addRequestInterceptor(
      onFulfilled?: (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig | Promise<InternalAxiosRequestConfig>,
      onRejected?: (error: AxiosError) => any
    ): number {
      return this.instance.interceptors.request.use(onFulfilled, onRejected);
    }
  
    /**
     * Adds a custom response interceptor.
     */
    public addResponseInterceptor(
      onFulfilled?: (response: AxiosResponse) => AxiosResponse | Promise<AxiosResponse>,
      onRejected?: (error: AxiosError) => any
    ): number {
      return this.instance.interceptors.response.use(onFulfilled, onRejected);
    }
  
    /**
     * Removes a request interceptor by ID.
     */
    public removeRequestInterceptor(id: number): void {
      this.instance.interceptors.request.eject(id);
    }
  
    /**
     * Removes a response interceptor by ID.
     */
    public removeResponseInterceptor(id: number): void {
      this.instance.interceptors.response.eject(id);
    }
  
    /**
     * Sets a default HTTP header for all requests.
     *
     * @param name - Header key.
     * @param value - Header value.
     */
    public setHeader(name: string, value: string): void {
      this.instance.defaults.headers.common[name] = value;
    }
  
    /**
     * Sets the Authorization header with a bearer token.
     *
     * @param token - Access token.
     * @param scheme - Optional scheme (defaults to "Bearer").
     */
    public setAuthToken(token: string, scheme: string = 'Bearer'): void {
      this.setHeader('Authorization', `${scheme} ${token}`);
    }
  
    /**
     * Clears the Authorization header.
     */
    public clearAuthToken(): void {
      delete this.instance.defaults.headers.common['Authorization'];
    }
  }

  /** Default client instance */
  const axiosClient = new ApiClient();


  /** Re-export of axios cancellation checker */
  export const isCancel = axios.isCancel;

  export { ApiClient };
  export default axiosClient;
