/**
 * Testes das funções puras do notifier:
 *  - classifyConversionError(): classifica erros em FailureType
 *  - getNotifiableType(): distingue user-fixable de silent
 *
 * Funções com I/O (Redis, Evolution API, Telegram) ficam fora do escopo
 * desses testes — precisariam de mock mais elaborado.
 */
import { describe, expect, it } from 'bun:test';
import {
  classifyConversionError,
  getNotifiableType,
  buildNotificationText,
  type FailureType,
  type UserFixableType,
} from './notifier.ts';

describe('classifyConversionError', () => {
  describe('mercadolivre → cookie_expired', () => {
    it.each([
      'HTTP 401 returned',
      'unauthorized access',
      'Não autorizado',
      'cookie expired',
      'session not found',
      'HTTP 403 Forbidden',
      'HTTP 400 Bad Request',
    ])('detecta "%s"', (msg) => {
      expect(classifyConversionError('mercadolivre', msg)).toBe('cookie_expired');
    });

    it('case-insensitive', () => {
      expect(classifyConversionError('mercadolivre', 'COOKIE EXPIRED')).toBe('cookie_expired');
    });
  });

  describe('mercadolivre → refresh_token_expired', () => {
    it.each(['refresh token expired', 'invalid_grant', 'expired_token detected', 'token expirado'])(
      'detecta "%s"',
      (msg) => {
        expect(classifyConversionError('mercadolivre', msg)).toBe('refresh_token_expired');
      },
    );
  });

  describe('mercadolivre → ml_account_not_linked', () => {
    it.each([
      'melitat not configured',
      'sem afiliado vinculado',
      'conta não vinculada',
      'affiliate not linked',
      'no affiliate configured',
    ])('detecta "%s"', (msg) => {
      expect(classifyConversionError('mercadolivre', msg)).toBe('ml_account_not_linked');
    });
  });

  describe('shopee → invalid_shopee_creds', () => {
    it.each([
      'app id inválido',
      'app_id not found',
      'invalid credential',
      'credencial inválida', // singular, igual ao código-fonte
      'shopee returned 403',
      'forbidden',
      'access denied',
      'appid missing',
      'secret mismatch',
    ])('detecta "%s"', (msg) => {
      expect(classifyConversionError('shopee', msg)).toBe('invalid_shopee_creds');
    });
  });

  describe('amazon → invalid_amazon_tracking_id', () => {
    it.each(['tracking id inválido', 'tag not configured', 'invalid tracking_id'])(
      'detecta "%s"',
      (msg) => {
        expect(classifyConversionError('amazon', msg)).toBe('invalid_amazon_tracking_id');
      },
    );
  });

  describe('evolution_api_offline (qualquer marketplace)', () => {
    it.each([
      'fetch failed',
      'connect ECONNREFUSED 127.0.0.1:5444',
      'econnreset peer',
      'etimedout',
      'network unreachable',
      'request timeout',
      'DNS resolution failed',
      'getaddrinfo ENOTFOUND',
    ])('detecta "%s"', (msg) => {
      expect(classifyConversionError('mercadolivre', msg)).toBe('evolution_api_offline');
      expect(classifyConversionError('shopee', msg)).toBe('evolution_api_offline');
      expect(classifyConversionError('amazon', msg)).toBe('evolution_api_offline');
    });
  });

  describe('retorna null quando não classifica', () => {
    it('erro genérico em marketplace conhecido', () => {
      expect(classifyConversionError('mercadolivre', 'something weird')).toBeNull();
    });

    it('erro de rede ainda é evolution_api_offline mesmo com marketplace unknown', () => {
      // O classificador trata "fetch failed" como erro de conexão, sem
      // depender do marketplace. Isso é desejável: se a Evolution API
      // estiver offline, marketplace não importa.
      expect(classifyConversionError('unknown', 'fetch failed')).toBe('evolution_api_offline');
    });

    it('mensagem vazia', () => {
      expect(classifyConversionError('mercadolivre', '')).toBeNull();
    });
  });

  describe('prioridade de classificação', () => {
    it('cookie_expired ganha de evolution_api_offline quando "cookie" aparece', () => {
      // "fetch failed" sozinho → evolution_api_offline
      expect(classifyConversionError('mercadolivre', 'fetch failed')).toBe('evolution_api_offline');
      // mas com palavra "cookie" → cookie_expired (específico ML)
      expect(classifyConversionError('mercadolivre', 'cookie fetch failed')).toBe('cookie_expired');
    });

    it('refresh_token_expired ganha de evolution_api_offline', () => {
      expect(classifyConversionError('mercadolivre', 'network refresh token expired')).toBe(
        'refresh_token_expired',
      );
    });
  });
});

describe('getNotifiableType', () => {
  it('marca user-fixable types como notificáveis', () => {
    const userFixable: UserFixableType[] = [
      'cookie_expired',
      'refresh_token_expired',
      'invalid_shopee_creds',
      'invalid_amazon_tracking_id',
      'ml_account_not_linked',
      'magalu_account_not_linked',
      'evolution_api_offline',
    ];

    for (const type of userFixable) {
      expect(getNotifiableType(type)).toBe(type);
    }
  });

  it('retorna null para silent types', () => {
    const silent: Array<FailureType> = ['network_timeout', 'dedup', 'blacklist'];

    for (const type of silent) {
      expect(getNotifiableType(type)).toBeNull();
    }
  });
});

// ─── buildNotificationText (pura) ─────────────────────────────────────

describe('buildNotificationText', () => {
  it('usa formato de relatório agrupado quando total > 1', () => {
    const text = buildNotificationText('cookie_expired', 47);
    expect(text).toContain('📊 *Relatório de falhas*');
    expect(text).toContain('47 ofertas bloqueadas por cookie expirado.');
    expect(text).toContain(
      '🍪 Cookies de sessão do Mercado Livre expirados.\nReimporte os cookies pela extensão Chrome.',
    );
  });

  it('usa formato de aviso único quando total === 1', () => {
    const text = buildNotificationText('cookie_expired', 1);
    expect(text).toContain('⚠️');
    expect(text).toContain(
      '🍪 Cookies de sessão do Mercado Livre expirados.\nReimporte os cookies pela extensão Chrome.',
    );
    expect(text).not.toContain('Relatório de falhas');
  });

  it('usa formato de aviso único quando total === 0 (limite)', () => {
    const text = buildNotificationText('refresh_token_expired', 0);
    expect(text).toContain('⚠️');
    expect(text).not.toContain('Relatório de falhas');
  });

  it('inclui o label correto por tipo de falha', () => {
    expect(buildNotificationText('ml_account_not_linked', 5)).toContain(
      '5 ofertas bloqueadas por conta ML não vinculada.',
    );
    expect(buildNotificationText('invalid_amazon_tracking_id', 3)).toContain(
      '3 ofertas bloqueadas por tracking Amazon não configurado.',
    );
    expect(buildNotificationText('evolution_api_offline', 12)).toContain(
      '12 ofertas bloqueadas por Evolution API offline.',
    );
  });

  it('múltiplas ocorrências atingem o formato agrupado exato em 2', () => {
    const text = buildNotificationText('cookie_expired', 2);
    expect(text).toContain('2 ofertas bloqueadas por cookie expirado.');
    expect(text).toContain('Relatório de falhas');
  });
});
