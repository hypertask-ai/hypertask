export interface ApiClientRequestOptions {
  timeoutMs?: number
}

export interface IApiClient {
  makeRequest<T>(
    endpoint: string,
    options?: RequestInit,
    correlationId?: string,
    requestOptions?: ApiClientRequestOptions
  ): Promise<T>
}
