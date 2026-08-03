/**
 * E2E: integração Magalu (Influenciador Magalu / Magazine Você).
 *
 * Cobre:
 *   - Estado inicial sem integração
 *   - Cadastro de slug (PUT) e remoção (DELETE)
 *   - Validação de slug inválido → 400
 *   - Conversão com o slug cadastrado
 *   - Compatibilidade do perfil e do teste de conversão compartilhado
 */
import { test, expect } from '@playwright/test';
import { createTestUser, authGet, authPut, authDelete, authPost } from '../../helpers/index.ts';

const VALID_SLUG = 'magazinee2e';
const INVALID_SLUG = 'A'; // muito curto

test.describe('Magalu — cadastro de afiliado', () => {
  test('GET sem afiliado retorna configured: false', async () => {
    const { token } = await createTestUser();
    const res = await authGet('/api/magalu/affiliate', token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      configured: false,
      affiliate: null,
    });
  });

  test('PUT com slug válido → 200 e GET reflete o slug', async () => {
    const { token } = await createTestUser();
    const put = await authPut('/api/magalu/affiliate', token, {
      nickname: 'E2E - Magalu',
      storeSlug: VALID_SLUG,
    });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      success: true,
      affiliate: expect.objectContaining({ storeSlug: VALID_SLUG, active: true }),
    });

    const get = await authGet('/api/magalu/affiliate', token);
    expect(get.status).toBe(200);
    expect(get.body).toMatchObject({
      configured: true,
      affiliate: expect.objectContaining({ storeSlug: VALID_SLUG }),
    });
  });

  test('PUT com slug inválido → 400 com mensagem clara', async () => {
    const { token } = await createTestUser();
    const res = await authPut('/api/magalu/affiliate', token, {
      storeSlug: INVALID_SLUG,
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: expect.stringContaining('Slug da loja inválido'),
    });
  });

  test('DELETE remove afiliado', async () => {
    const { token } = await createTestUser();
    await authPut('/api/magalu/affiliate', token, { storeSlug: VALID_SLUG });

    const del = await authDelete('/api/magalu/affiliate', token);
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ success: true });

    const check = await authGet('/api/magalu/affiliate', token);
    expect(check.body).toMatchObject({ configured: false });
  });
});

test.describe('Magalu convert — conversão de URL', () => {
  async function setupAffiliate(): Promise<string> {
    const { token } = await createTestUser();
    await authPut('/api/magalu/affiliate', token, { storeSlug: VALID_SLUG });
    return token;
  }

  test('converte magazineluiza.com.br/p/ID com slug cadastrado', async () => {
    const token = await setupAffiliate();
    const res = await authPost('/api/magalu/convert', token, {
      url: 'https://www.magazineluiza.com.br/celular-x/p/12345/',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      marketplace: 'magalu',
    });
    expect((res.body as any).affiliateUrl).toContain(`magazinevoce.com.br/${VALID_SLUG}/`);
    expect((res.body as any).affiliateUrl).toContain('/p/12345/');
  });

  test('converte magazinevoce.com.br de outra loja trocando o slug', async () => {
    const token = await setupAffiliate();
    const res = await authPost('/api/magalu/convert', token, {
      url: `https://www.magazinevoce.com.br/outraloja/celular-x/p/12345/in/te/`,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect((res.body as any).affiliateUrl).toContain(`magazinevoce.com.br/${VALID_SLUG}/`);
  });

  test('URL que não é da Magalu retorna erro', async () => {
    const token = await setupAffiliate();
    const res = await authPost('/api/magalu/convert', token, {
      url: 'https://www.mercadolivre.com.br/p/MLB123',
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false });
    expect((res.body as any).error).toContain('Magalu');
  });

  test('sem afiliado configurado → 404 com erro descritivo', async () => {
    const { token } = await createTestUser();
    const res = await authPost('/api/magalu/convert', token, {
      url: 'https://www.magazineluiza.com.br/celular-x/p/12345/',
    });
    expect(res.status).toBe(404);
    expect((res.body as any).error).toContain('não configurado');
  });
});

test.describe('Magalu — profile e test-conversion legado', () => {
  test('profile retorna bloco magalu', async () => {
    const { token } = await createTestUser();
    const res = await authGet('/api/affiliate/profile', token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      profile: expect.objectContaining({
        magalu: { connected: false },
      }),
    });
  });

  test('profile com afiliado cadastrado → connected true + slug', async () => {
    const { token } = await createTestUser();
    await authPut('/api/magalu/affiliate', token, {
      nickname: 'E2E - Magalu',
      storeSlug: VALID_SLUG,
    });

    const res = await authGet('/api/affiliate/profile', token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      profile: expect.objectContaining({
        magalu: expect.objectContaining({ connected: true, storeSlug: VALID_SLUG, active: true }),
      }),
    });
  });

  test('test-conversion com plataforma magalu usa novo modelo', async () => {
    const { token } = await createTestUser();
    await authPut('/api/magalu/affiliate', token, { storeSlug: VALID_SLUG });

    const res = await authPost('/api/affiliate/test-conversion', token, {
      url: 'https://www.magazineluiza.com.br/celular-x/p/12345/',
      platform: 'magalu',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      marketplace: 'magalu',
    });
    expect((res.body as any).affiliateUrl).toContain(`magazinevoce.com.br/${VALID_SLUG}/`);
  });
});
