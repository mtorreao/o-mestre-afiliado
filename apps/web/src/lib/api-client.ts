/**
 * ApiClient — Typed fetch wrapper with toast on error
 *
 * Uso:
 *   const data = await fetchApi<{ success: boolean; profile: Profile }>(
 *     '/api/affiliate/profile',
 *     { headers: { Authorization: `Bearer ${token}` } },
 *   );
 *   if (!data.success) {
 *     showErrorToast('Erro', data.error || 'Falha ao carregar');
 *     return;
 *   }
 *   // data.data.profile disponível com tipo seguro
 */

import { showErrorToast } from './toast-emitter.ts';

interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function fetchApi<T = unknown>(
  url: string,
  options?: RequestInit,
  toastOnError = true,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, options);
    const json = await res.json() as T & { success?: boolean; error?: string };
    const result: ApiResult<T> = {
      success: json.success !== false,
      data: json,
      error: json.error,
    };
    if (toastOnError && !result.success && result.error) {
      showErrorToast('Erro', result.error);
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro de conexão';
    if (toastOnError) {
      showErrorToast('Erro de conexão', message);
    }
    return { success: false, error: message };
  }
}
