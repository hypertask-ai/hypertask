import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from 'axios'
import { getConfig } from '../config/index'
import type { ApiClientRequestOptions, IApiClient } from '../types/index'
import { generateCorrelationId } from '../utils/correlation'
import { ApiError, mapHttpErrorToMcpError } from '../utils/errors'
import { logger } from '../utils/logger'

function messageFromErrorBody(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const body = data as Record<string, unknown>
  if (typeof body.message === 'string' && body.message) return body.message
  if (typeof body.error === 'string' && body.error) return body.error
  return undefined
}

export class ApiClient implements IApiClient {
  private readonly axiosInstance: AxiosInstance
  private readonly defaultTimeout: number
  private readonly resolvedBaseUrl: string

  constructor(jwtToken: string, baseUrl?: string, timeout?: number) {
    const config = getConfig()
    this.resolvedBaseUrl = baseUrl ?? config.apiUrl
    this.defaultTimeout = timeout ?? config.requestTimeout
    this.axiosInstance = axios.create({
      baseURL: this.resolvedBaseUrl,
      timeout: this.defaultTimeout,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwtToken}`,
      },
    })

    this.axiosInstance.interceptors.request.use((request) => {
      if (!request.headers['X-Correlation-ID']) {
        request.headers['X-Correlation-ID'] = generateCorrelationId()
      }
      return request
    })

    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        const correlationId = (error.config?.headers as Record<string, string> | undefined)?.[
          'X-Correlation-ID'
        ]

        if (error.response) {
          const message =
            messageFromErrorBody(error.response.data) ??
            `HTTP ${error.response.status}: ${error.response.statusText}`
          throw mapHttpErrorToMcpError(
            error.response.status,
            message,
            correlationId,
            error.response.data
          )
        }

        if (error.request) {
          if (error.code === 'ECONNABORTED') {
            throw new ApiError(
              `Request timeout after ${error.config?.timeout ?? this.defaultTimeout}ms`,
              undefined,
              undefined,
              correlationId
            )
          }
          throw new ApiError(`Network error: ${error.message}`, undefined, undefined, correlationId)
        }

        throw new ApiError(`Request error: ${error.message}`, undefined, undefined, correlationId)
      }
    )
  }

  async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {},
    correlationId?: string,
    requestOptions?: ApiClientRequestOptions
  ): Promise<T> {
    const requestCorrelationId = correlationId ?? generateCorrelationId()
    const axiosConfig: AxiosRequestConfig = {
      url: endpoint,
      timeout: requestOptions?.timeoutMs,
    }

    if (options.method) {
      axiosConfig.method = options.method.toLowerCase() as AxiosRequestConfig['method']
    }
    if (options.body) {
      axiosConfig.data = typeof options.body === 'string' ? JSON.parse(options.body) : options.body
    }
    if (options.headers) {
      axiosConfig.headers = Object.fromEntries(new Headers(options.headers).entries())
    }
    axiosConfig.headers = {
      ...axiosConfig.headers,
      'X-Correlation-ID': requestCorrelationId,
    }

    logger.debug('MCP self-API request', {
      correlationId: requestCorrelationId,
      method: (axiosConfig.method ?? 'get').toUpperCase(),
      endpoint,
      baseUrl: this.resolvedBaseUrl,
    })

    const response = await this.axiosInstance.request<T>(axiosConfig)
    const contentType = String(response.headers?.['content-type'] ?? '').toLowerCase()
    if (typeof response.data === 'string' && contentType.includes('text/html')) {
      throw new ApiError(
        `Expected JSON from backend but received HTML. Check API base URL, auth token forwarding, and redirect behavior. Endpoint: ${endpoint}`,
        response.status,
        response.data.slice(0, 300),
        requestCorrelationId
      )
    }

    return response.data
  }
}

export function createApiClient(jwtToken: string): IApiClient {
  return new ApiClient(jwtToken)
}
