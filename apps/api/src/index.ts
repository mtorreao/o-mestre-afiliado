/**
 * @omestre/api — Elysia API para conversão de links de afiliados
 */

import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { convertUrl } from '@omestre/converters';
import { detectMarketplace } from '@omestre/shared';

const PORT = parseInt(process.env.API_PORT || '3000', 10);

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
      docs: '/docs',
    },
  }))
  .get('/health', () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }))
  .post(
    '/api/convert',
    async ({ body }) => {
      const { url } = body as { url: string };

      if (!url) {
        return {
          success: false,
          error: 'URL é obrigatória',
        };
      }

      const marketplace = detectMarketplace(url);
      if (marketplace === 'unknown') {
        return {
          success: false,
          originalUrl: url,
          error: 'Marketplace não suportado. Aceito: Shopee, Mercado Livre',
        };
      }

      try {
        const result = await convertUrl(url);
        return result;
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
        summary: 'Converter link de afiliado',
        description: 'Converte uma URL de produto em link de afiliado (Shopee ou Mercado Livre)',
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
  );

app.listen(PORT);

console.log(`🦊 API rodando em http://localhost:${PORT}`);
console.log(`📖 Swagger docs em http://localhost:${PORT}/docs`);
console.log(`💓 Health check em http://localhost:${PORT}/health`);

export type App = typeof app;
