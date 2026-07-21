/**
 * @omestre/api — Elysia API para conversão de links de afiliados
 *
 * Inclui fluxo OAuth multi-afiliado para Mercado Livre (protótipo).
 * A conversão de links ML usa URL params (meliid/melitat) por afiliado.
 */

import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { convertUrl, getAccessToken, generateViaUrlParams } from '@omestre/converters';
import { detectMarketplace } from '@omestre/shared';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PORT = parseInt(process.env.API_PORT || '5442', 10);
const ML_CLIENT_ID = process.env.ML_CLIENT_ID || '';
const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.ML_REDIRECT_URI || 'http://localhost:5442/api/ml/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5441';

// ─── Store de afiliados (JSON file) ─────────────────────────────────────

interface AffiliateRecord {
  mlUserId: string;
  nickname: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;   // ISO
  connectedAt: string; // ISO
  lastUsedAt: string;  // ISO
  meliid?: string;     // fallback URL param
  melitat?: string;    // fallback URL param
}

const DATA_DIR = join(import.meta.dir, '../../../data');
const STORE_PATH = join(DATA_DIR, 'ml-affiliates.json');

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readStore(): Record<string, AffiliateRecord> {
  ensureDataDir();
  try {
    return JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, AffiliateRecord>) {
  ensureDataDir();
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

// ─── App ─────────────────────────────────────────────────────────────────

const app = new Elysia()
  .use(cors())
  .use(
    swagger({
      path: '/docs',
      documentation: {
        info: {
          title: 'O Mestre Afiliado — API',
          description: 'API para conversão de links de afiliados (Shopee, Mercado Livre)',
          version: '1.0.0',
        },
      },
    }),
  )
  .get('/', () => ({
    service: 'O Mestre Afiliado API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      convert: 'POST /api/convert',
      'ml/auth': 'GET /api/ml/auth',
      'ml/callback': 'GET /api/ml/callback',
      'ml/affiliates': 'GET /api/ml/affiliates',
      'ml/convert': 'POST /api/ml/convert',
      'ml/affiliates/:mlUserId': 'PUT /api/ml/affiliates/:mlUserId',
      docs: '/docs',
    },
  }))
  .get('/health', () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }))

  // ─── Conversão padrão (usa .env) ─────────────────────────────────────
  .post(
    '/api/convert',
    async ({ body }) => {
      const { url } = body as { url: string };
      if (!url) return { success: false, error: 'URL é obrigatória' };

      const marketplace = detectMarketplace(url);
      if (marketplace === 'unknown') {
        return {
          success: false,
          originalUrl: url,
          error: 'Marketplace não suportado. Aceito: Shopee, Mercado Livre',
        };
      }

      try {
        return await convertUrl(url);
      } catch (error) {
        return {
          success: false,
          originalUrl: url,
          marketplace,
          error: error instanceof Error ? error.message : 'Erro interno',
        };
      }
    },
    {
      detail: {
        summary: 'Converter link de afiliado (padrão)',
        description: 'Converte uma URL usando as credenciais do .env',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  url: { type: 'string', example: 'https://shopee.com.br/product/123/456' },
                },
                required: ['url'],
              },
            },
          },
        },
      },
    },
  )

  // ─── ML OAuth — Iniciar fluxo ────────────────────────────────────────
  .get('/api/ml/auth', ({ redirect }) => {
    if (!ML_CLIENT_ID) {
      return { success: false, error: 'ML_CLIENT_ID não configurado no .env' };
    }
    const authUrl =
      `https://auth.mercadolivre.com.br/authorization` +
      `?response_type=code` +
      `&client_id=${ML_CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    return redirect(authUrl);
  })

  // ─── ML OAuth — Callback ─────────────────────────────────────────────
  .get('/api/ml/callback', async ({ query, set, redirect }) => {
    const { code, error: oauthError } = query as { code?: string; error?: string };

    if (oauthError) {
      set.status = 400;
      return { success: false, error: `Erro na autorização: ${oauthError}` };
    }

    if (!code) {
      set.status = 400;
      return { success: false, error: 'Código de autorização não fornecido' };
    }

    if (!ML_CLIENT_ID || !ML_CLIENT_SECRET) {
      set.status = 500;
      return { success: false, error: 'Credenciais ML não configuradas no servidor' };
    }

    try {
      // Trocar code por tokens
      const tokenRes = await getAccessToken(ML_CLIENT_ID, ML_CLIENT_SECRET, code, REDIRECT_URI);

      const store = readStore();
      const mlUserId = String(tokenRes.user_id);

      // Buscar nickname do usuário no ML (opcional, só pra exibir bonito)
      let nickname = mlUserId;
      try {
        const meRes = await fetch('https://api.mercadolibre.com/users/me', {
          headers: { Authorization: `Bearer ${tokenRes.access_token}` },
        });
        if (meRes.ok) {
          const me = await meRes.json() as { nickname?: string };
          if (me.nickname) nickname = me.nickname;
        }
      } catch { /* fallback: usa mlUserId */ }

      // Salvar/atualizar (preserva meliid/melitat se já existirem)
      store[mlUserId] = {
        mlUserId,
        nickname,
        accessToken: tokenRes.access_token,
        refreshToken: tokenRes.refresh_token,
        expiresAt: new Date(Date.now() + tokenRes.expires_in * 1000).toISOString(),
        connectedAt: store[mlUserId]?.connectedAt || new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        meliid: store[mlUserId]?.meliid,
        melitat: store[mlUserId]?.melitat,
      };
      writeStore(store);

      // Redirecionar pro frontend
      return redirect(`${FRONTEND_URL}?ml_connected=${mlUserId}`);
    } catch (err) {
      set.status = 500;
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao trocar code por token',
      };
    }
  })

  // ─── ML — Listar afiliados conectados ────────────────────────────────
  .get('/api/ml/affiliates', () => {
    const store = readStore();
    const list = Object.values(store).map((a) => ({
      mlUserId: a.mlUserId,
      nickname: a.nickname,
      connectedAt: a.connectedAt,
      lastUsedAt: a.lastUsedAt,
      expiresAt: a.expiresAt,
      expired: new Date(a.expiresAt) < new Date(),
      meliid: a.meliid || null,
      melitat: a.melitat || null,
    }));
    return { success: true, affiliates: list };
  })

  // ─── ML — Atualizar configurações do afiliado (meliid/melitat) ──────
  .put(
    '/api/ml/affiliates/:mlUserId',
    async ({ params, body, set }) => {
      const { mlUserId } = params as { mlUserId: string };
      const { meliid, melitat } = body as { meliid?: string; melitat?: string };

      const store = readStore();
      if (!store[mlUserId]) {
        set.status = 404;
        return { success: false, error: 'Afiliado não encontrado' };
      }

      store[mlUserId] = {
        ...store[mlUserId],
        ...(meliid !== undefined ? { meliid } : {}),
        ...(melitat !== undefined ? { melitat } : {}),
      };
      writeStore(store);

      return {
        success: true,
        mlUserId,
        meliid: store[mlUserId].meliid || null,
        melitat: store[mlUserId].melitat || null,
      };
    },
    {
      detail: {
        summary: 'Atualizar parâmetros de afiliado (meliid/melitat)',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  meliid: { type: 'string', description: 'MELIID para URL params' },
                  melitat: { type: 'string', description: 'MELITAT para URL params' },
                },
              },
            },
          },
        },
      },
    },
  )

  // ─── ML — Converter usando URL params do afiliado selecionado ───────
  .post(
    '/api/ml/convert',
    async ({ body, set }) => {
      const { url, mlUserId } = body as { url: string; mlUserId?: string };

      if (!url) {
        set.status = 400;
        return { success: false, error: 'URL é obrigatória' };
      }

      if (!mlUserId) {
        set.status = 400;
        return { success: false, error: 'mlUserId é obrigatório' };
      }

      const marketplace = detectMarketplace(url);
      if (marketplace !== 'mercadolivre') {
        set.status = 400;
        return {
          success: false,
          error: 'URL não é do Mercado Livre',
          originalUrl: url,
          marketplace: marketplace as string,
        };
      }

      const store = readStore();
      const affiliate = store[mlUserId];

      if (!affiliate) {
        set.status = 404;
        return { success: false, error: `Afiliado ${mlUserId} não encontrado. Conecte-se primeiro.` };
      }

      if (!affiliate.melitat) {
        set.status = 400;
        return {
          success: false,
          error: `Afiliado ${affiliate.nickname} não possui melitat configurado. Configure em "Configurar" no card do afiliado.`,
        };
      }

      // Atualiza lastUsedAt
      store[mlUserId] = { ...affiliate, lastUsedAt: new Date().toISOString() };
      writeStore(store);

      // Gera link usando URL params do afiliado selecionado
      try {
        let targetUrl = url;
        // Resolver link curto meli.la
        if (/meli\.la\//i.test(url)) {
          const resolved = await fetch(url, { method: 'HEAD', redirect: 'manual' });
          const location = resolved.headers.get('location');
          if (location && location !== url) {
            targetUrl = location;
          }
        }

        const affiliateUrl = generateViaUrlParams(targetUrl, {
          meliid: affiliate.meliid,
          melitat: affiliate.melitat,
        });

        return {
          success: true,
          originalUrl: url,
          affiliateUrl,
          marketplace: 'mercadolivre' as const,
          method: 'fallback' as const,
          mlUserId,
          nickname: affiliate.nickname,
        };
      } catch (error) {
        return {
          success: false,
          originalUrl: url,
          affiliateUrl: null,
          marketplace: 'mercadolivre' as const,
          method: 'unknown' as const,
          error: error instanceof Error ? error.message : 'Erro ao gerar link de afiliado',
          mlUserId,
          nickname: affiliate.nickname,
        };
      }
    },
    {
      detail: {
        summary: 'Converter link (multi-afiliado)',
        description: 'Converte URL usando meliid/melitat do afiliado selecionado',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  url: { type: 'string' },
                  mlUserId: { type: 'string', description: 'ID do afiliado (retornado ao conectar)' },
                },
                required: ['url', 'mlUserId'],
              },
            },
          },
        },
      },
    },
  )

  // ─── ML — Refresh manual de um afiliado ─────────────────────────────
  .post('/api/ml/refresh', async ({ body, set }) => {
    const { mlUserId } = body as { mlUserId: string };
    if (!mlUserId) {
      set.status = 400;
      return { success: false, error: 'mlUserId é obrigatório' };
    }

    const store = readStore();
    const affiliate = store[mlUserId];
    if (!affiliate) {
      set.status = 404;
      return { success: false, error: 'Afiliado não encontrado' };
    }

    try {
      const refreshed = await getAccessToken(
        ML_CLIENT_ID,
        ML_CLIENT_SECRET,
        undefined,
        undefined,
        affiliate.refreshToken,
      );
      store[mlUserId] = {
        ...affiliate,
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token,
        expiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        lastUsedAt: new Date().toISOString(),
      };
      writeStore(store);
      return { success: true, mlUserId, expiresAt: store[mlUserId].expiresAt };
    } catch (err) {
      set.status = 500;
      return { success: false, error: err instanceof Error ? err.message : 'Refresh falhou' };
    }
  })

  // ─── ML — Remover afiliado ──────────────────────────────────────────
  .delete('/api/ml/affiliates/:mlUserId', ({ params, set }) => {
    const { mlUserId } = params as { mlUserId: string };
    const store = readStore();
    if (!store[mlUserId]) {
      set.status = 404;
      return { success: false, error: 'Afiliado não encontrado' };
    }
    delete store[mlUserId];
    writeStore(store);
    return { success: true, message: `Afiliado ${mlUserId} removido` };
  });

app.listen(PORT);

console.log(`🦊 API rodando em http://localhost:${PORT}`);
console.log(`📖 Swagger docs em http://localhost:${PORT}/docs`);
console.log(`🔗 ML OAuth iniciar: http://localhost:${PORT}/api/ml/auth`);
console.log(`📁 Store: ${STORE_PATH}`);

export type App = typeof app;
