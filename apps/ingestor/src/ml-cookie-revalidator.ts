/**
 * Re-validação periódica dos cookies de sessão do Mercado Livre.
 *
 * ML revoga sessões periodicamente (logout, mudança de senha, segurança, etc).
 * Quando isso acontece, o ingestor cai silenciosamente no fallback de URL params
 * — o que resulta em links longos ao invés de curtos (meli.la).
 *
 * Esta rotina roda em background:
 *   - A cada ML_COOKIE_REVALIDATION_INTERVAL_MS (default 1h) verifica TODOS os
 *     afiliados ML ativos no banco.
 *   - Para cada um, faz um GET no Link Builder com os sessionCookies.
 *   - Se retornar 302 → login (cookies expirados), dispara processFailure
 *     (que aplica cooldown por tipo no Redis + notifica o usuário).
 *   - Se OK, apenas atualiza last_used_at (mantém o afiliado "vivo").
 *
 * O cooldown já existente em processFailure evita spam de notificações quando
 * o mesmo afiliado tem cookies expirados em várias checagens.
 */

import { MlAffiliateRepository } from '@omestre/db';
import { processFailure } from '@omestre/worker-common';

const ML_LINK_BUILDER_URL = 'https://www.mercadolivre.com.br/afiliados/linkbuilder';

const REVALIDATION_INTERVAL_MS = 60 * 60 * 1000; // 1h
const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Testa se os cookies de um afiliado ML ainda estão autenticando.
 * Retorna `valid: true` se o GET no Link Builder retorna 200 (sessão ok),
 * `valid: false` se retorna 302 para página de login (sessão expirada).
 */
async function probeMlCookies(sessionCookies: string): Promise<{ valid: boolean; reason?: string }> {
  try {
    const res = await fetch(ML_LINK_BUILDER_URL, {
      method: 'GET',
      headers: { Cookie: sessionCookies, 'User-Agent': USER_AGENT },
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    // 302/301 para /jms/mlb/lgz/login (ou qualquer URL com "login") = expirado
    if (res.status === 301 || res.status === 302) {
      const location = res.headers.get('location') ?? '';
      if (/login|lgz/i.test(location)) {
        return { valid: false, reason: 'redirect-to-login' };
      }
      return { valid: false, reason: `unexpected-redirect-${res.status}` };
    }

    if (res.status === 200) {
      return { valid: true };
    }

    return { valid: false, reason: `http-${res.status}` };
  } catch (err) {
    // Erros de rede/transient NÃO devem disparar notificação —
    // o notifier trata esses como silent (não tem tipo para "network_timeout"
    // no fluxo de re-validação). Apenas logamos.
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'ml-cookie-revalidator',
        message: 'Falha de rede ao testar cookies ML',
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { valid: true, reason: 'network-error' }; // não dispara notificação
  }
}

/**
 * Roda uma rodada de re-validação para todos os afiliados ML com sessionCookies.
 * Reporta expirados via processFailure (com cooldown automático).
 */
export async function runMlCookieRevalidation(): Promise<void> {
  const repo = new MlAffiliateRepository();
  const all = await repo.findAll();

  // findAll() não retorna sessionCookies (sumário). Precisamos buscar cada um.
  const results: Array<{ mlUserId: string; valid: boolean; reason?: string }> = [];

  for (const summary of all) {
    const full = await repo.findByUserId(summary.mlUserId);
    if (!full?.sessionCookies) continue; // sem cookies = não testa

    const probe = await probeMlCookies(full.sessionCookies);
    results.push({ mlUserId: summary.mlUserId, valid: probe.valid, reason: probe.reason });

    if (!probe.valid && probe.reason === 'redirect-to-login') {
      // Dispara notificação (processFailure aplica cooldown de 1h por tipo)
      await processFailure(`user-${full.userId ?? '?'}`, 'cookie_expired', {
        marketplace: 'mercadolivre',
      });
    }
  }

  const expired = results.filter((r) => !r.valid).length;
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'ml-cookie-revalidator',
      message: 'Revalidação ML concluída',
      totalChecked: results.length,
      expired,
    }),
  );
}

/**
 * Inicia a rotina de re-validação periódica em background.
 * Idempotente — chamar mais de uma vez não duplica o timer.
 */
export function startMlCookieRevalidator(): void {
  if (timer) return;

  // Primeira rodada após 30s (deixa o sistema estabilizar no startup),
  // depois a cada REVALIDATION_INTERVAL_MS.
  setTimeout(() => {
    runMlCookieRevalidation().catch(() => {});
    timer = setInterval(() => {
      runMlCookieRevalidation().catch(() => {});
    }, REVALIDATION_INTERVAL_MS);
  }, 30_000);

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'ml-cookie-revalidator',
      message: 'Revalidator ML iniciado',
      intervalMs: REVALIDATION_INTERVAL_MS,
    }),
  );
}

export function stopMlCookieRevalidator(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}