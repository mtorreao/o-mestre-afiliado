/**
 * Testes E2E de API — Template de Mensagem
 *
 * Requer: API rodando em http://localhost:15442 (E2E stack)
 *
 * Cobertura:
 *   - PUT /api/affiliate/message-template — salvar template
 *   - POST /api/affiliate/validate-template — validação de placeholders
 *   - POST /api/affiliate/preview-template — preview do template
 *   - Autenticação (requisições sem token)
 */
import { test, expect } from '@playwright/test';
import {
  createTestUser,
  authGet,
  authPost,
  authPut,
} from './helpers.ts';

test.describe('Template API', () => {
  let token: string;

  test.beforeAll(async () => {
    const user = await createTestUser();
    token = user.token;
  });

  // ─── PUT /api/affiliate/message-template ─────────────────────────────

  test('1. PUT /api/affiliate/message-template — salvar template personalizado', async () => {
    const { status, body } = await authPut('/api/affiliate/message-template', token, {
      messageTemplate: '{marketplace_nome}: {texto_original}',
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test('2. PUT /api/affiliate/message-template — salvar null (reset para padrão)', async () => {
    const { status, body } = await authPut('/api/affiliate/message-template', token, {
      messageTemplate: null,
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test('3. PUT /api/affiliate/message-template — sem token retorna 401', async () => {
    const res = await fetch('http://localhost:15442/api/affiliate/message-template', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageTemplate: 'teste' }),
    });
    expect(res.status).toBe(401);
  });

  // ─── POST /api/affiliate/validate-template ───────────────────────────

  test('4. POST /api/affiliate/validate-template — template válido', async () => {
    const { status, body } = await authPost(
      '/api/affiliate/validate-template',
      token,
      { template: '{texto_original}' },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.valid).toBe(true);
    expect(body.unknownPlaceholders).toEqual([]);
    expect(body.containsConditional).toBe(false);
    expect(body.containsLinkOrText).toBe(true);
  });

  test('5. POST /api/affiliate/validate-template — placeholders desconhecidos', async () => {
    const { status, body } = await authPost(
      '/api/affiliate/validate-template',
      token,
      { template: '{texto_original} {placeholder_invalido} {outro_errado}' },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.unknownPlaceholders).toContain('placeholder_invalido');
    expect(body.unknownPlaceholders).toContain('outro_errado');
  });

  test('6. POST /api/affiliate/validate-template — detecta condicionais', async () => {
    const { status, body } = await authPost(
      '/api/affiliate/validate-template',
      token,
      { template: '{? marketplace = shopee}Shopee{/}' },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.containsConditional).toBe(true);
    expect(body.conditionalErrors).toEqual([]);
  });

  test('7. POST /api/affiliate/validate-template — bloco condicional desbalanceado', async () => {
    const { status, body } = await authPost(
      '/api/affiliate/validate-template',
      token,
      { template: '{? marketplace = shopee}Shopee' },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.conditionalErrors.length).toBeGreaterThan(0);
    expect(body.conditionalErrors[0]).toContain('desbalanceados');
  });

  test('8. POST /api/affiliate/validate-template — template vazio', async () => {
    const { status, body } = await authPost(
      '/api/affiliate/validate-template',
      token,
      { template: '' },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.valid).toBe(true);
    expect(body.containsLinkOrText).toBe(false);
  });

  // ─── POST /api/affiliate/preview-template ───────────────────────────

  test('9. POST /api/affiliate/preview-template — renderizar template simples', async () => {
    const { status, body } = await authPost(
      '/api/affiliate/preview-template',
      token,
      {
        template: 'Confira: {link_convertido}',
        testUrl: 'https://shopee.com.br/produto-123',
        convertedUrl: 'https://s.shopee.com.br/aff-link',
        marketplace: 'shopee',
      },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.preview).toContain('Confira:');
    expect(body.preview).toContain('https://s.shopee.com.br/aff-link');
    expect(body.isEmpty).toBe(false);
    expect(body.length).toBeGreaterThan(0);
    expect(body.unknownPlaceholders).toEqual([]);
  });

  test('10. POST /api/affiliate/preview-template — renderizar com marketplace_nome', async () => {
    const { status, body } = await authPost(
      '/api/affiliate/preview-template',
      token,
      {
        template: '{marketplace_nome}: {link_convertido}',
        testUrl: 'https://mercadolivre.com.br/produto',
        convertedUrl: 'https://meli.la/abc123',
        marketplace: 'mercadolivre',
      },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.preview).toContain('Mercado Livre:');
    expect(body.preview).toContain('https://meli.la/abc123');
  });

  test('11. POST /api/affiliate/preview-template — renderizar com condicional', async () => {
    const { status, body } = await authPost(
      '/api/affiliate/preview-template',
      token,
      {
        template: '{? marketplace = shopee}🛒 Shopee{:/}📦 Outro{/}',
        testUrl: 'https://shopee.com.br/produto',
        marketplace: 'shopee',
      },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.preview).toContain('🛒 Shopee');
  });

  test('12. POST /api/affiliate/preview-template — com source_group e target_group', async () => {
    const { status, body } = await authPost(
      '/api/affiliate/preview-template',
      token,
      {
        template: 'De {source_group} para {target_group}: {link_convertido}',
        testUrl: 'https://amazon.com.br/produto',
        convertedUrl: 'https://amzn.to/aff-link',
        marketplace: 'amazon',
        sourceGroupName: 'Ofertas Gerais',
        targetGroupName: 'Grupo VIP',
      },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.preview).toContain('De Ofertas Gerais');
    expect(body.preview).toContain('para Grupo VIP');
    expect(body.preview).toContain('https://amzn.to/aff-link');
  });

  test('13. POST /api/affiliate/preview-template — detecta placeholders desconhecidos', async () => {
    const { status, body } = await authPost(
      '/api/affiliate/preview-template',
      token,
      {
        template: '{texto_original} {inválido}',
        testUrl: 'https://shopee.com.br/p',
        marketplace: 'shopee',
      },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.unknownPlaceholders).toContain('inválido');
  });

  test('14. POST /api/affiliate/preview-template — template vazio retorna isEmpty', async () => {
    const { status, body } = await authPost(
      '/api/affiliate/preview-template',
      token,
      {
        template: '   ',
        testUrl: 'https://shopee.com.br/p',
        marketplace: 'shopee',
      },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.isEmpty).toBe(true);
    expect(body.length).toBeGreaterThan(0); // espaços contam
  });

  test('15. POST /api/affiliate/preview-template — sem template retorna 400', async () => {
    const { status, body } = await authPost(
      '/api/affiliate/preview-template',
      token,
      {
        testUrl: 'https://shopee.com.br/p',
        marketplace: 'shopee',
      },
    );
    expect(body.success).toBe(false);
  });

  // ─── Sintaxe humanizada ─────────────────────────────────────────────

  test('16. POST /api/affiliate/preview-template — renderiza sintaxe humanizada {se ...}', async () => {
    const { status, body } = await authPost(
      '/api/affiliate/preview-template',
      token,
      {
        template: "{se marketplace for igual a 'shopee'}🛒 Shopee{senão}📦 Outro{fim}",
        testUrl: 'https://shopee.com.br/produto',
        marketplace: 'shopee',
      },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.preview).toContain('🛒 Shopee');
  });

  test('17. POST /api/affiliate/preview-template — renderiza inline {se X então A senão B}', async () => {
    const { status, body } = await authPost(
      '/api/affiliate/preview-template',
      token,
      {
        template: "{se marketplace for igual a 'shopee' então 🛒 senão 📦}",
        testUrl: 'https://shopee.com.br/produto',
        marketplace: 'shopee',
      },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.preview).toBe('🛒');
  });

  test('18. POST /api/affiliate/validate-template — detecta {se} balanceado', async () => {
    const { status, body } = await authPost(
      '/api/affiliate/validate-template',
      token,
      { template: "{se marketplace for igual a 'shopee'}🛒{fim}" },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.containsConditional).toBe(true);
    expect(body.conditionalErrors).toEqual([]);
  });

  test('19. POST /api/affiliate/validate-template — detecta {se} desbalanceado', async () => {
    const { status, body } = await authPost(
      '/api/affiliate/validate-template',
      token,
      { template: "{se marketplace for igual a 'shopee'}🛒" },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.valid).toBe(false);
    expect(body.conditionalErrors.length).toBeGreaterThan(0);
    expect(body.conditionalErrors[0]).toContain('{se}');
  });
});
