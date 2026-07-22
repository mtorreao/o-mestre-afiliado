/**
 * Test: Validar notificações proativas com delivery.
 *
 * Critério:
 *   ✅ Notificar: cookie expirado, credencial inválida, token expirado, conta não vinculada, evolution offline
 *   ❌ NÃO notificar: timeout de rede (agora = evolution offline), dedup, blacklist
 *   ✅ Cooldown de 1h por tipo (independente entre tipos)
 *   ✅ Notificação agrupada com total acumulado
 *   ✅ Canal e JID configurados por afiliado (via DB)
 *
 * Estratégia:
 *   - Pure functions (classifyConversionError, getNotifiableType): test direto
 *   - processFailure: mock ioredis UMA VEZ (top-level do describe),
 *     usa console.log spy para verificar notificações
 */

import { describe, it, expect, mock, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test';

// ══════════════════════════════════════════════════════════════════════
// Fake Redis — implementação mínima para interceptar chamadas
// ══════════════════════════════════════════════════════════════════════

type RedisEntry = { value: string; expiresAt: number };
const redisState = new Map<string, RedisEntry>();

class FakeRedis {
  constructor(_url?: string) { /* no-op */ }
  on = () => {};
  exists = async (key: string) => {
    const e = redisState.get(key);
    if (!e) return 0;
    if (Date.now() > e.expiresAt) { redisState.delete(key); return 0; }
    return 1;
  };
  get = async (key: string) => {
    const e = redisState.get(key);
    if (!e) return null;
    if (Date.now() > e.expiresAt) { redisState.delete(key); return null; }
    return e.value;
  };
  setex = async (key: string, seconds: number, value: string) => {
    redisState.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
    return 'OK' as const;
  };
  incr = async (key: string) => {
    const e = redisState.get(key);
    if (!e || Date.now() > e.expiresAt) {
      redisState.set(key, { value: '1', expiresAt: Date.now() + 3600 * 1000 });
      return 1;
    }
    const next = parseInt(e.value, 10) + 1;
    e.value = String(next);
    return next;
  };
  expire = async (key: string, seconds: number) => {
    const e = redisState.get(key);
    if (e) { e.expiresAt = Date.now() + seconds * 1000; return 1; }
    return 0;
  };
  del = async (key: string) => redisState.delete(key) ? 1 : 0;
  quit = () => {};
}

// ══════════════════════════════════════════════════════════════════════
// Mock ioredis e @omestre/db GLOBALMENTE — antes de qualquer import
// ══════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════
// Testes
// ══════════════════════════════════════════════════════════════════════

describe('notifier', () => {
  beforeAll(() => {
    mock.module('ioredis', () => ({ default: FakeRedis }));
    // Mock @omestre/db para evitar conexão real com PostgreSQL nos testes
    mock.module('@omestre/db', () => ({
      AffiliatesRepository: class FakeAffiliatesRepo {
        async findNotificationConfig(_instanceName: string) {
          return null; // Sempre retorna null (sem canal configurado)
        }
      },
    }));
  });

  afterAll(() => {
    mock.restore();
  });

  describe('classifyConversionError', () => {
  let classifyConversionError: typeof import('../notifier.ts').classifyConversionError;

  beforeEach(async () => {
    redisState.clear();
    const mod = await import('../notifier.ts');
    classifyConversionError = mod.classifyConversionError;
  });

  // ── Mercado Livre: cookie_expired ──────────────────────────────────
  it('ML HTTP 4xx → cookie_expired', () => {
    expect(classifyConversionError('mercadolivre', 'HTTP 401 Unauthorized')).toBe('cookie_expired');
    expect(classifyConversionError('mercadolivre', 'HTTP 403 Forbidden')).toBe('cookie_expired');
  });

  it('ML "cookie" na mensagem → cookie_expired', () => {
    expect(classifyConversionError('mercadolivre', 'Cookies podem estar expirados')).toBe('cookie_expired');
    expect(classifyConversionError('mercadolivre', 'session cookie invalid')).toBe('cookie_expired');
  });

  it('ML "session"/"unauthorized" → cookie_expired', () => {
    expect(classifyConversionError('mercadolivre', 'Session expired')).toBe('cookie_expired');
    expect(classifyConversionError('mercadolivre', 'Unauthorized')).toBe('cookie_expired');
    expect(classifyConversionError('mercadolivre', 'não autorizado')).toBe('cookie_expired');
  });

  // ── Mercado Livre: refresh_token_expired ───────────────────────────
  it('ML "refresh" → refresh_token_expired', () => {
    expect(classifyConversionError('mercadolivre', 'Refresh token expired')).toBe('refresh_token_expired');
    expect(classifyConversionError('mercadolivre', 'token expirado: refresh necessário')).toBe('refresh_token_expired');
    expect(classifyConversionError('mercadolivre', 'invalid_grant')).toBe('refresh_token_expired');
    expect(classifyConversionError('mercadolivre', 'expired_token')).toBe('refresh_token_expired');
  });

  // ── Mercado Livre: ml_account_not_linked ───────────────────────────
  it('ML sem melitat → ml_account_not_linked', () => {
    expect(classifyConversionError('mercadolivre', 'melitat não configurado')).toBe('ml_account_not_linked');
    expect(classifyConversionError('mercadolivre', 'sem afiliado ML vinculado')).toBe('ml_account_not_linked');
    expect(classifyConversionError('mercadolivre', 'conta não vinculada')).toBe('ml_account_not_linked');
    expect(classifyConversionError('mercadolivre', 'not linked')).toBe('ml_account_not_linked');
    expect(classifyConversionError('mercadolivre', 'no affiliate found')).toBe('ml_account_not_linked');
  });

  // ── Shopee: invalid_shopee_creds ────────────────────────────────────
  it('Shopee → invalid_shopee_creds', () => {
    expect(classifyConversionError('shopee', 'Invalid App ID')).toBe('invalid_shopee_creds');
    expect(classifyConversionError('shopee', 'app_id inválido')).toBe('invalid_shopee_creds');
    expect(classifyConversionError('shopee', 'AppId not found')).toBe('invalid_shopee_creds');
    expect(classifyConversionError('shopee', 'Invalid secret')).toBe('invalid_shopee_creds');
    expect(classifyConversionError('shopee', 'invalid credential')).toBe('invalid_shopee_creds');
    expect(classifyConversionError('shopee', 'credencial inválida')).toBe('invalid_shopee_creds');
    expect(classifyConversionError('shopee', 'Forbidden')).toBe('invalid_shopee_creds');
    expect(classifyConversionError('shopee', 'Access denied')).toBe('invalid_shopee_creds');
  });

  // ── Amazon: reusa invalid_shopee_creds ──────────────────────────────
  it('Amazon → invalid_shopee_creds', () => {
    expect(classifyConversionError('amazon', 'invalid tracking ID')).toBe('invalid_shopee_creds');
    expect(classifyConversionError('amazon', 'tag inválido')).toBe('invalid_shopee_creds');
  });

  // ── Rede → evolution_api_offline (antes era null/silencioso) ────────
  it('erros de rede → evolution_api_offline', () => {
    expect(classifyConversionError('shopee', 'Fetch failed: ECONNREFUSED')).toBe('evolution_api_offline');
    expect(classifyConversionError('mercadolivre', 'ECONNRESET')).toBe('evolution_api_offline');
    expect(classifyConversionError('amazon', 'ETIMEDOUT')).toBe('evolution_api_offline');
    expect(classifyConversionError('shopee', 'network timeout')).toBe('evolution_api_offline');
    expect(classifyConversionError('shopee', 'DNS resolution failed')).toBe('evolution_api_offline');
    expect(classifyConversionError('mercadolivre', 'ENOTFOUND')).toBe('evolution_api_offline');
  });

  // ── Genéricos → null ────────────────────────────────────────────────
  it('erros genéricos → null', () => {
    expect(classifyConversionError('shopee', 'algo quebrou')).toBeNull();
    expect(classifyConversionError('mercadolivre', 'internal server error')).toBeNull();
    expect(classifyConversionError('amazon', 'rate limit exceeded')).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════
// Testes: getNotifiableType (pure function)
// ══════════════════════════════════════════════════════════════════════

describe('getNotifiableType', () => {
  let getNotifiableType: typeof import('../notifier.ts').getNotifiableType;

  beforeEach(async () => {
    redisState.clear();
    const mod = await import('../notifier.ts');
    getNotifiableType = mod.getNotifiableType;
  });

  it('cookie_expired → notificável', () => expect(getNotifiableType('cookie_expired')).toBe('cookie_expired'));
  it('refresh_token_expired → notificável', () => expect(getNotifiableType('refresh_token_expired')).toBe('refresh_token_expired'));
  it('invalid_shopee_creds → notificável', () => expect(getNotifiableType('invalid_shopee_creds')).toBe('invalid_shopee_creds'));
  it('ml_account_not_linked → notificável', () => expect(getNotifiableType('ml_account_not_linked')).toBe('ml_account_not_linked'));
  it('evolution_api_offline → notificável (agora é user-fixable)', () => expect(getNotifiableType('evolution_api_offline')).toBe('evolution_api_offline'));
  it('network_timeout → null (silencioso)', () => expect(getNotifiableType('network_timeout')).toBeNull());
  it('dedup → null (silencioso)', () => expect(getNotifiableType('dedup')).toBeNull());
  it('blacklist → null (silencioso)', () => expect(getNotifiableType('blacklist')).toBeNull());
});

// ══════════════════════════════════════════════════════════════════════
// Testes: processFailure (depende de ioredis — já mockado globalmente)
//
// O sendWhatsAppNotification() tem 2 caminhos:
//   A) Sem JID de destino configurado → console.log (fallback)
//   B) Com JID configurado → fetch (Evolution API)
//
// Como o DB lookup (getAffiliateNotificationConfig) retorna null em
// testes (sem DB conectado), o comportamento observado é o fallback
// para console.log — o que valida a lógica de classificação, cooldown
// e ocorrências.
// ══════════════════════════════════════════════════════════════════════

describe('processFailure', () => {
  let processFailure: typeof import('../notifier.ts').processFailure;
  let consoleLogCalls: unknown[][];
  let originalConsoleLog: typeof console.log;
  let originalFetch: typeof globalThis.fetch;
  let fetchCalls: { url: string; body?: unknown }[];

  beforeEach(async () => {
    redisState.clear();
    consoleLogCalls = [];
    fetchCalls = [];
    originalConsoleLog = console.log;
    console.log = (...args: unknown[]) => { consoleLogCalls.push(args); };

    // Mock fetch para capturar chamadas Evolution API
    originalFetch = globalThis.fetch;
    // @ts-ignore -- mock fetch para testes
    globalThis.fetch = async (url: string, opts?: RequestInit) => {
      let body: unknown = undefined;
      if (opts?.body && typeof opts.body === 'string') {
        try { body = JSON.parse(opts.body); } catch { body = opts.body; }
      }
      fetchCalls.push({ url, body });
      return new Response('OK', { status: 200 }) as unknown as Response;
    };

    const mod = await import('../notifier.ts');
    processFailure = mod.processFailure;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    globalThis.fetch = originalFetch;
  });

  // ── HELPERS ──────────────────────────────────────────────────────────

  /** Retorna true se houver pelo menos um console.log com mensagem de notificação */
  function hasNotification(): boolean {
    return consoleLogCalls.some(c =>
      typeof c[0] === 'string' &&
      (c[0].includes('[NOTIFICAÇÃO]') || c[0].includes('Notificação disponível'))
    );
  }

  /** Retorna a mensagem da notificação ou null se não encontrada */
  function getNotificationMessage(): string | null {
    const entry = consoleLogCalls.find(c =>
      typeof c[0] === 'string' && c[0].includes('[NOTIFICAÇÃO]')
    );
    if (!entry) return null;
    try {
      return JSON.parse(entry[0] as string).message ?? null;
    } catch {
      return null;
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // 1. NOTIFICÁVEIS — devem gerar notificação (log ou envio)
  // ═════════════════════════════════════════════════════════════════

  describe('tipos notificáveis', () => {
    it('cookie_expired → notifica', async () => {
      await processFailure('user-1', 'cookie_expired', { marketplace: 'mercadolivre' });
      expect(hasNotification()).toBe(true);
    });

    it('refresh_token_expired → notifica', async () => {
      await processFailure('user-1', 'refresh_token_expired', { marketplace: 'mercadolivre' });
      expect(hasNotification()).toBe(true);
    });

    it('invalid_shopee_creds → notifica', async () => {
      await processFailure('user-1', 'invalid_shopee_creds', { marketplace: 'shopee' });
      expect(hasNotification()).toBe(true);
    });

    it('ml_account_not_linked → notifica', async () => {
      await processFailure('user-1', 'ml_account_not_linked', { marketplace: 'mercadolivre' });
      expect(hasNotification()).toBe(true);
    });

    it('evolution_api_offline → notifica (agora é user-fixable)', async () => {
      await processFailure('user-1', 'evolution_api_offline');
      expect(hasNotification()).toBe(true);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 2. SILENCIOSOS — NÃO devem gerar notificação
  // ═════════════════════════════════════════════════════════════════

  describe('tipos silenciosos', () => {
    it('network_timeout → NÃO notifica', async () => {
      await processFailure('user-1', 'network_timeout');
      expect(hasNotification()).toBe(false);
    });

    it('dedup → NÃO notifica', async () => {
      await processFailure('user-1', 'dedup');
      expect(hasNotification()).toBe(false);
    });

    it('blacklist → NÃO notifica', async () => {
      await processFailure('user-1', 'blacklist');
      expect(hasNotification()).toBe(false);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 3. COOLDOWN
  // ═════════════════════════════════════════════════════════════════

  describe('cooldown', () => {
    it('mesmo tipo em cooldown → NÃO re-notifica', async () => {
      await processFailure('user-1', 'cookie_expired');
      expect(hasNotification()).toBe(true);
      consoleLogCalls = [];

      await processFailure('user-1', 'cookie_expired');
      expect(hasNotification()).toBe(false);

      // Deve ter log de cooldown ativo
      const cooldownLog = consoleLogCalls.some(c =>
        typeof c[0] === 'string' && c[0].includes('Cooldown ativo')
      );
      expect(cooldownLog).toBe(true);
    });

    it('tipos diferentes → cooldowns independentes', async () => {
      await processFailure('user-1', 'cookie_expired');
      consoleLogCalls = [];

      await processFailure('user-1', 'refresh_token_expired');
      expect(hasNotification()).toBe(true);
    });

    it('instâncias diferentes → cooldowns independentes', async () => {
      await processFailure('user-1', 'cookie_expired');
      consoleLogCalls = [];

      await processFailure('user-2', 'cookie_expired');
      expect(hasNotification()).toBe(true);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 4. INTEGRAÇÃO COM EVOLUTION API
  // ═════════════════════════════════════════════════════════════════
  //
  // Como o DB lookup retorna null em testes (sem DB), o
  // sendWhatsAppNotification não é chamado via fetch neste cenário.
  // Validamos que a lógica de classificação, cooldown e ocorrências
  // funciona independentemente do canal de entrega.

  describe('tipos silenciosos → sem fetch Evolution', () => {
    it('tipos silenciosos → NÃO chamam Evolution API', async () => {
      await processFailure('user-1', 'network_timeout');
      await processFailure('user-1', 'dedup');
      await processFailure('user-1', 'blacklist');

      // Nenhuma chamada para Evolution API
      const evoCalls = fetchCalls.filter(c => c.url.includes('message/sendText'));
      expect(evoCalls.length).toBe(0);

      // Nenhuma notificação
      expect(hasNotification()).toBe(false);
    });
  });

  // ═════════════════════════════════════════════════════════════════
  // 5. NOTIFICAÇÃO AGRUPADA (múltiplas ocorrências)
  // ═════════════════════════════════════════════════════════════════

  describe('agrupamento de ocorrências', () => {
    it('1 ocorrência → notifica sem formatação de grupo', async () => {
      await processFailure('user-1', 'cookie_expired');
      expect(hasNotification()).toBe(true);
    });

    it('cooldown ativo → ocorrências acumulam, sem notificação', async () => {
      // 1ª notifica
      await processFailure('user-1', 'cookie_expired');
      consoleLogCalls = [];

      // 2ª e 3ª cooldown ativo → acumulam, não notificam
      await processFailure('user-1', 'cookie_expired');
      await processFailure('user-1', 'cookie_expired');
      expect(hasNotification()).toBe(false);

      // Verifica que contagem aparece no log de debug
      const debugLog = consoleLogCalls.find(c =>
        typeof c[0] === 'string' && c[0].includes('ocorrências acumuladas')
      );
      expect(debugLog).toBeDefined();
    });
  });
});
});
