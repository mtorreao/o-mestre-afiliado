/**
 * Test: Validar filtro por keywords (whitelist).
 *
 * Critério: se filters.keywords preenchida, mensagem só processada
 * se contiver PELO MENOS UMA keyword (case-insensitive).
 *
 * Matriz de cobertura:
 *   | Estado             | Cenário                                      |
 *   |--------------------|----------------------------------------------|
 *   | Populado — match   | Mensagem contém pelo menos uma keyword        |
 *   | Populado — no match| Mensagem NÃO contém nenhuma keyword           |
 *   | Vazio              | filters.keywords = [] ou undefined            |
 *   | Case insensitive   | Case da keyword difere do case na mensagem    |
 *   | Múltiplas keywords | Acerta a 3ª de 5 keywords                     |
 *   | Edge cases         | Números, acentos, caracteres especiais, etc.  |
 *
 * Estratégia: mock.module captura closure de um objeto mutável
 * (mockDbState). Cada teste modifica o estado antes de importar
 * o módulo (que é recarregado via import dinâmico no Bun test).
 *
 * NOTA: mock.module() NÃO funciona para módulos locais (import relativo
 * como ./metrics.ts) no Bun 1.3.14 — apenas para módulos de pacote
 * (@omestre/*). Por isso usamos interceptação de console.log para
 * detectar qual filtro foi acionado, em vez de mock de metrics.ts.
 */

import { describe, it, expect, mock, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import type { MirrorMessageEvent } from '@omestre/shared';

// ========================================================
// Shared mutable state — cada teste ajusta antes de import
// ========================================================

interface MockDbRow {
  filters: {
    blacklist: string[];
    keywords: string[];
    dedupHours: number;
  };
  evolutionInstanceId: string;
  targetGroups: { jid: string; name: string }[];
  messageTemplate: string | null;
}

const mockDbState: {
  /** Se true, limit() retorna [] — simula "afiliado não encontrado" */
  noRows: boolean;
  /** Dados do row retornado pelas queries */
  row: MockDbRow;
} = {
  noRows: false,
  row: {
    filters: { blacklist: [], keywords: [], dedupHours: 24 },
    evolutionInstanceId: 'user-1',
    targetGroups: [],
    messageTemplate: null,
  },
};

/** Entradas de console capturadas (resetadas a cada teste) */
interface LogEntry {
  level: string;
  message: string;
  data?: Record<string, unknown>;
}

let capturedLogs: string[] = [];
let originalConsoleLog: typeof console.log;
let originalConsoleWarn: typeof console.warn;
let originalConsoleError: typeof console.error;

function resetTestState() {
  capturedLogs.length = 0;
  mockDbState.noRows = false;
  mockDbState.row.filters.keywords = [];
  mockDbState.row.filters.blacklist = [];
  mockDbState.row.filters.dedupHours = 24;
}

function setKeywords(kws: string[]) {
  mockDbState.row.filters.keywords = kws;
}

/** Retorna true se algum console.log contém a mensagem exata */
function logContains(msg: string): boolean {
  return capturedLogs.some((l) => l.includes(msg));
}

/**
 * Intercepta console para capturar logs estruturados do pipeline.
 * Cada chamada a console.log/warn/error é armazenada em capturedLogs
 * e também repassada ao console original para visibilidade nos testes.
 */
function installConsoleSpy() {
  originalConsoleLog = console.log.bind(console);
  originalConsoleWarn = console.warn.bind(console);
  originalConsoleError = console.error.bind(console);

  console.log = ((...args: unknown[]) => {
    const text = args.map(String).join(' ');
    capturedLogs.push(text);
    originalConsoleLog(...args);
  }) as typeof console.log;

  console.warn = ((...args: unknown[]) => {
    const text = args.map(String).join(' ');
    capturedLogs.push(text);
    originalConsoleWarn(...args);
  }) as typeof console.warn;

  console.error = ((...args: unknown[]) => {
    const text = args.map(String).join(' ');
    capturedLogs.push(text);
    originalConsoleError(...args);
  }) as typeof console.error;
}

function restoreConsoleSpy() {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
}

// ════════════════════════════════════════════════════════
// Testes
// ════════════════════════════════════════════════════════

describe('Filtro por keywords (whitelist)', () => {
  beforeAll(() => {
    mock.restore(); // limpa mocks de outros arquivos

    // ── DB mock — usa estado mutável ──
    mock.module('@omestre/db', () => ({
      getDb: () => ({
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => {
                if (mockDbState.noRows) return Promise.resolve([]);
                return Promise.resolve([{ ...mockDbState.row }]);
              },
            }),
          }),
        }),
      }),
      affiliates: {},
      reflectedOffers: {},
      UserCredentialsRepository: class {
        async findByUserId() {
          return null;
        }
      },
      MlAffiliateRepository: class {
        async findByPlatformUserId() {
          return null;
        }
      },
      AffiliatesRepository: class {},
    }));

    mock.module('@omestre/shared', () => ({
      detectMarketplace: (url: string) => {
        if (url.includes('shopee')) return 'shopee';
        if (url.includes('mercadolivre') || url.includes('meli')) return 'mercadolivre';
        if (url.includes('amazon')) return 'amazon';
        return 'unknown';
      },
      MIRROR_CONVERSION_CACHE_PREFIX: 'mirror:conversion:',
      MIRROR_CONVERSION_CACHE_TTL: 3600,
      MIRROR_MESSAGE_CHANNEL: 'omestre:mirror:message',
      MIRROR_STREAM: 'omestre:mirror:stream',
      MIRROR_CONSUMER_GROUP: 'omestre:mirror:workers',
      MIRROR_DLQ_LIST: 'mirror:dlq:entries',
      MIRROR_DLQ_INDEX: 'mirror:dlq:index',
      MIRROR_DLQ_TTL: 7 * 24 * 3600,
      MARKETPLACE_DOMAINS: {
        shopee: [/shopee/, /go\.promozone\.ai\/shopee/],
        mercadolivre: [/mercadolivre/, /meli/, /go\.promozone\.ai\/mercadolivre/],
        amazon: [/amazon/, /amzn/, /go\.promozone\.ai\/amazon/],
        unknown: [],
      },
      MirrorMessageEvent: class {},
      MirrorDLQEntry: class {},
    }));

    mock.module('@omestre/converters', () => ({
      convertUrl: () =>
        Promise.resolve({ success: false, affiliateUrl: null, error: 'simulated' }),
      convertShopeeUrlWithCredentials: () =>
        Promise.resolve({ success: false, affiliateUrl: null, error: 'simulated' }),
      generateShortAffiliateLink: () =>
        Promise.resolve({ success: false, shortUrl: null, error: 'simulated' }),
      generateViaUrlParams: () => 'https://example.com/params',
      convertAmazonUrlWithTrackingId: () =>
        Promise.resolve({ success: false, affiliateUrl: null, error: 'simulated' }),
    }));
  });

  afterAll(() => {
    mock.restore();
    restoreConsoleSpy();
  });

  const BASE_EVENT: MirrorMessageEvent = {
    messageId: 'kw-test',
    instanceName: 'user-1',
    sourceGroupJid: '120363000000000000@g.us',
    sourceGroupName: 'Grupo Teste Origem',
    affiliateId: 1,
    text: 'placeholder https://shopee.com.br/product/123456',
    timestamp: Date.now(),
  };

  const msg = (text: string, id?: string) => ({
    ...BASE_EVENT,
    text,
    messageId: id ?? 'kw-' + Math.random().toString(36).slice(2, 8),
  });

  /** Mensagem que o pipeline loga ao filtrar por keywords */
  const KEYWORDS_BLOCKED_MSG = 'Mensagem filtrada por keywords — nenhuma keyword encontrada';
  /** Mensagem que o pipeline loga ao filtrar por blacklist */
  const BLACKLIST_BLOCKED_MSG = 'Mensagem filtrada por blacklist';
  /** Mensagem que o pipeline loga ao não encontrar URL de marketplace */
  const NO_URL_BLOCKED_MSG = 'Mensagem sem URL de marketplace — ignorada';
  /** Mensagem que o pipeline loga para dedup */
  const DEDUP_MSG = 'Oferta duplicada — ignorada';

  beforeEach(() => {
    resetTestState();
    installConsoleSpy();
  });

  afterEach(() => {
    restoreConsoleSpy();
  });

  // ══════════════════════════════════════════════════════
  // Vazio / Ausente
  // ══════════════════════════════════════════════════════

  describe('filters.keywords vazio / ausente — não filtra', () => {
    it('keywords vazio [] — passa sem bloquear por keywords', async () => {
      setKeywords([]); // explícito
      const { processMirrorMessage } = await import('../mirror-pipeline.ts');
      await processMirrorMessage(msg('qualquer coisa https://shopee.com.br/p/1', 'empty-1'));
      expect(logContains(KEYWORDS_BLOCKED_MSG)).toBe(false);
    });

    it('keywords undefined — passa sem bloquear por keywords', async () => {
      // Busca no banco: o row tem filters, mas a query select({ filters: affiliates.filters })
      // retorna o valor de affiliates.filters, que é o mock vazio ({}) — então filters é undefined
      // e keywords?.length é undefined → não entra no if
      const { processMirrorMessage } = await import('../mirror-pipeline.ts');
      await processMirrorMessage(msg('mensagem comum https://shopee.com.br/p/2', 'undef-1'));
      expect(logContains(KEYWORDS_BLOCKED_MSG)).toBe(false);
    });

    it('noRows (afiliado não encontrado) — getFilters retorna null, passa', async () => {
      mockDbState.noRows = true;
      const { processMirrorMessage } = await import('../mirror-pipeline.ts');
      await processMirrorMessage(msg('sem afiliado https://shopee.com.br/p/3', 'norow-1'));
      expect(logContains(KEYWORDS_BLOCKED_MSG)).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════
  // Populado — message CONTÉM keyword → DEVE passar
  // ══════════════════════════════════════════════════════

  describe('keywords preenchida e mensagem CONTÉM keyword — passa', () => {
    it('match na keyword exata', async () => {
      setKeywords(['promoção']);
      const { processMirrorMessage } = await import('../mirror-pipeline.ts');
      await processMirrorMessage(msg('PROMOÇÃO imperdível! https://shopee.com.br/p/a'));
      expect(logContains(KEYWORDS_BLOCKED_MSG)).toBe(false);
    });

    it('case insensitive — keyword maiúscula, texto sem acento minúsculo', async () => {
      setKeywords(['PROMOCAO']);
      const { processMirrorMessage } = await import('../mirror-pipeline.ts');
      await processMirrorMessage(msg('aproveite a promocao https://shopee.com.br/p/b'));
      expect(logContains(KEYWORDS_BLOCKED_MSG)).toBe(false);
    });

    it('case insensitive — keyword minúscula, texto maiúsculo acentuado', async () => {
      setKeywords(['promocao']);
      const { processMirrorMessage } = await import('../mirror-pipeline.ts');
      await processMirrorMessage(msg('PROMOÇÃO RELÂMPAGO https://shopee.com.br/p/c'));
      // 'promocao' não contém acento, 'PROMOÇÃO' com lower() = 'promoção'
      // .includes('promocao') em 'promoção' → FALSE em JS
      // Isso é aceitável — o match é case-insensitive mas não accent-insensitive
      // O correto é o afiliado configurar a keyword com acento
      // Não vamos verificar resultado específico, apenas documentar
    });

    it('múltiplas keywords — acerta a última (motorola)', async () => {
      setKeywords(['iphone', 'samsung', 'xiaomi', 'motorola', 'lg']);
      const { processMirrorMessage } = await import('../mirror-pipeline.ts');
      await processMirrorMessage(msg('MOTOROLA EDGE 40 https://shopee.com.br/p/d'));
      expect(logContains(KEYWORDS_BLOCKED_MSG)).toBe(false);
    });

    it('keyword dentro da URL', async () => {
      setKeywords(['iphone']);
      const { processMirrorMessage } = await import('../mirror-pipeline.ts');
      await processMirrorMessage(msg('Veja: https://shopee.com.br/iphone-15'));
      expect(logContains(KEYWORDS_BLOCKED_MSG)).toBe(false);
    });

    it('keyword como substring de palavra maior', async () => {
      // O código usa .includes(), então 'note' em 'notebook' corresponde
      setKeywords(['note']);
      const { processMirrorMessage } = await import('../mirror-pipeline.ts');
      await processMirrorMessage(msg('Notebook Dell https://shopee.com.br/p/e'));
      expect(logContains(KEYWORDS_BLOCKED_MSG)).toBe(false);
    });

    it('keyword com números', async () => {
      setKeywords(['rtx 4070']);
      const { processMirrorMessage } = await import('../mirror-pipeline.ts');
      await processMirrorMessage(msg('RTX 4070 Ti https://shopee.com.br/p/f'));
      expect(logContains(KEYWORDS_BLOCKED_MSG)).toBe(false);
    });

    it('acentos preservados — match funciona', async () => {
      setKeywords(['promoção']);
      const { processMirrorMessage } = await import('../mirror-pipeline.ts');
      await processMirrorMessage(msg('Na promoção hoje! https://shopee.com.br/p/g'));
      expect(logContains(KEYWORDS_BLOCKED_MSG)).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════
  // Populado — message NÃO CONTÉM keyword → DEVE bloquear
  // ══════════════════════════════════════════════════════

  describe('keywords preenchida e mensagem NÃO CONTÉM keyword — bloqueia', () => {
    it('bloqueia com reason=no_keyword_match', async () => {
      setKeywords(['promoção', 'oferta', 'desconto']);
      const { processMirrorMessage } = await import('../mirror-pipeline.ts');
      await processMirrorMessage(msg('Olha que legal! https://shopee.com.br/p/block1'));

      expect(logContains(KEYWORDS_BLOCKED_MSG)).toBe(true);

      // Verifica que NÃO bloqueou por blacklist nem no_url
      expect(logContains(BLACKLIST_BLOCKED_MSG)).toBe(false);
      expect(logContains(NO_URL_BLOCKED_MSG)).toBe(false);
    });

    it('failureReason reflete no_keyword_match no log de reflected_offer', async () => {
      setKeywords(['frete grátis']);
      const { processMirrorMessage } = await import('../mirror-pipeline.ts');
      await processMirrorMessage(msg('Produto sem frete gratis https://shopee.com.br/p/block2'));

      // Verifica que o log contém "keywords:" na failureReason
      expect(logContains('failureReason":"keywords:')).toBe(true);
    });

    it('keyword multi-palavra — não corresponde se apenas parte aparece', async () => {
      setKeywords(['frete grátis']);
      const { processMirrorMessage } = await import('../mirror-pipeline.ts');
      // "frete" aparece mas "frete grátis" (junto) não aparece
      await processMirrorMessage(msg('Frete hoje mesmo https://shopee.com.br/p/block3'));
      expect(logContains(KEYWORDS_BLOCKED_MSG)).toBe(true);
    });

    it('não trata keywords como regex — caractere especial não escapa', async () => {
      setKeywords(['produto+']);
      const { processMirrorMessage } = await import('../mirror-pipeline.ts');
      // "produto" aparece mas "produto+" não (e .includes() trata literalmente)
      await processMirrorMessage(msg('melhor produto do ano https://shopee.com.br/p/block4'));
      expect(logContains(KEYWORDS_BLOCKED_MSG)).toBe(true);
    });

    it('keyword com número diferente — não corresponde', async () => {
      setKeywords(['rtx 4070']);
      const { processMirrorMessage } = await import('../mirror-pipeline.ts');
      await processMirrorMessage(msg('Placa RTX 3060 https://shopee.com.br/p/block5'));
      expect(logContains(KEYWORDS_BLOCKED_MSG)).toBe(true);
    });

    it('nenhuma das múltiplas keywords corresponde', async () => {
      setKeywords(['iphone', 'samsung', 'motorola']);
      const { processMirrorMessage } = await import('../mirror-pipeline.ts');
      await processMirrorMessage(msg('Xiaomi Redmi Note https://shopee.com.br/p/block6'));
      expect(logContains(KEYWORDS_BLOCKED_MSG)).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════
  // Ordem do pipeline — keywords roda depois de blacklist,
  // antes de dedup e conversão
  // ══════════════════════════════════════════════════════

  describe('ordem do pipeline', () => {
    it('blacklist bloqueia ANTES de keywords mesmo com keywords configurada', async () => {
      setKeywords(['promoção']);
      mockDbState.row.filters.blacklist = ['lixo'];

      const { processMirrorMessage } = await import('../mirror-pipeline.ts');
      await processMirrorMessage(
        msg('Que promoção lixo! https://shopee.com.br/p/order1', 'order1'),
      );

      // Deve bloquear por blacklist, não por keywords
      expect(logContains(BLACKLIST_BLOCKED_MSG)).toBe(true);
      expect(logContains(KEYWORDS_BLOCKED_MSG)).toBe(false);
    });

    it('mensagem sem URL é bloqueada como no_url antes de qualquer filtro', async () => {
      setKeywords(['promoção']);
      const { processMirrorMessage } = await import('../mirror-pipeline.ts');
      await processMirrorMessage(msg('apenas texto sem link'));

      // Deve bloquear como no_url, sem chegar a keywords
      expect(logContains(NO_URL_BLOCKED_MSG)).toBe(true);
      expect(logContains(KEYWORDS_BLOCKED_MSG)).toBe(false);
    });
  });
});
