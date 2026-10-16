import { invoke } from '../../legacy/invoke';

export class ApiError extends Error {
  constructor(message: string, public status: number, public revision?: number) { super(message); }
}

export async function requestJson(url: string, options: RequestInit = {}) {
  const clientId = invoke('AgentClient.getClientId') || '';
  const response = await fetch(url, { ...options, headers: {
    ...(!(options.body instanceof FormData) && { 'Content-Type': 'application/json' }),
    'X-Exdiary-Client-Id': clientId, ...options.headers,
  } });
  const body = await response.json();
  if (!response.ok || body.ok === false) {
    if (response.status === 401) invoke('showAuthModal');
    throw new ApiError(body.error?.message || body.error || body.message || `请求失败 (${response.status})`, response.status, body.revision);
  }
  return body;
}
