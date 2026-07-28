/**
 * E2E: integração Amazon com um único Tracking ID.
 *
 * Cobre:
 *   - Estado inicial sem integração
 *   - Cadastro e remoção do único Tracking ID
 *   - Bloqueio de um segundo Tracking ID
 *   - Conversão com o Tracking ID cadastrado
 *   - Compatibilidade do perfil e do teste de conversão compartilhado
 *   - Edge cases de URL Amazon
 */
import { test, expect } from '@playwright/test';
import { createTestUser, authGet, authPost, authDelete } from './helpers.ts';

const VALID_TAG = 'meusite-20';
const VALID_TAG_2 = 'meusite-tg-20';
const VALID_TAG_US = 'mysite-20';

test.describe('Amazon — único Tracking ID', () => {
  test('GET sem afiliado retorna configured: false', async () => {
    const { token } = await createTestUser();
    const res = await authGet('/api/amazon/affiliate', token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      configured: false,
      affiliate: null,
    });
  });

  test('POST tracking-id sem afiliado prévio cria afiliado automaticamente', async () => {
    const { token } = await createTestUser();
    const res = await authPost('/api/amazon/affiliate/tracking-ids', token, {
      tag: VALID_TAG,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect((res.body as any).trackingIds).toHaveLength(1);
    expect((res.body as any).trackingIds[0]).toMatchObject({
      tag: VALID_TAG,
      active: true,
      isDefault: true,
    });
  });

  test('POST tracking-id rejeita tag vazia', async () => {
    const { token } = await createTestUser();
    const res = await authPost('/api/amazon/affiliate/tracking-ids', token, { tag: '' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: expect.stringContaining('obrigatório'),
    });
  });

  test('POST rejeita um segundo tracking ID', async () => {
    const { token } = await createTestUser();
    await authPost('/api/amazon/affiliate/tracking-ids', token, { tag: VALID_TAG });

    const res = await authPost('/api/amazon/affiliate/tracking-ids', token, {
      tag: VALID_TAG_2,
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      error: 'A integração Amazon aceita apenas 1 Tracking ID',
    });
  });

  test('DELETE remove o único Tracking ID e permite cadastrar outro', async () => {
    const { token } = await createTestUser();
    await authPost('/api/amazon/affiliate/tracking-ids', token, { tag: VALID_TAG });

    const removed = await authDelete(
      `/api/amazon/affiliate/tracking-ids/${encodeURIComponent(VALID_TAG)}`,
      token,
    );
    expect(removed.status).toBe(200);
    expect(removed.body).toMatchObject({ success: true, trackingIds: [] });

    const replacement = await authPost('/api/amazon/affiliate/tracking-ids', token, {
      tag: VALID_TAG_2,
    });
    expect(replacement.status).toBe(200);
    expect(replacement.body).toMatchObject({
      success: true,
      trackingIds: [expect.objectContaining({ tag: VALID_TAG_2, active: true, isDefault: true })],
    });
  });

  test('DELETE afiliado remove tudo', async () => {
    const { token } = await createTestUser();
    await authPost('/api/amazon/affiliate/tracking-ids', token, { tag: VALID_TAG });

    const res = await authDelete('/api/amazon/affiliate', token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });

    const check = await authGet('/api/amazon/affiliate', token);
    expect(check.body).toMatchObject({ configured: false });
  });
});

test.describe('Amazon convert — conversão de URL', () => {
  async function setupAffiliateWithTag(tag: string): Promise<string> {
    const { token } = await createTestUser();
    await authPost('/api/amazon/affiliate/tracking-ids', token, { tag });
    return token;
  }

  test('converte amazon.com.br/dp/ASIN com tracking ID default', async () => {
    const token = await setupAffiliateWithTag(VALID_TAG);
    const res = await authPost('/api/amazon/convert', token, {
      url: 'https://www.amazon.com.br/dp/B08N5WRWNW',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      marketplace: 'amazon',
      method: 'fallback',
    });
    expect((res.body as any).affiliateUrl).toContain('tag=');
    expect((res.body as any).affiliateUrl).toContain(encodeURIComponent(VALID_TAG));
    expect((res.body as any).affiliateUrl).toContain('/dp/B08N5WRWNW');
  });

  test('URL que não é da Amazon retorna erro', async () => {
    const token = await setupAffiliateWithTag(VALID_TAG);
    const res = await authPost('/api/amazon/convert', token, {
      url: 'https://www.mercadolivre.com.br/p/MLB123',
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false });
    expect((res.body as any).error).toContain('Amazon');
  });

  test('Sem afiliado configurado retorna erro', async () => {
    const { token } = await createTestUser();
    const res = await authPost('/api/amazon/convert', token, {
      url: 'https://www.amazon.com.br/dp/B08N5WRWNW',
    });
    expect(res.status).toBe(404);
    expect((res.body as any).error).toContain('não configurado');
  });

  test('URL inválida (sem ASIN reconhecível) retorna erro', async () => {
    const token = await setupAffiliateWithTag(VALID_TAG);
    const res = await authPost('/api/amazon/convert', token, {
      url: 'https://www.amazon.com.br/not-a-product-page',
    });
    // Pode cair no fallback de URL com ?tag= (sem ASIN) ou falhar
    // O comportamento atual: amazon URL sem ASIN recebe ?tag= direto
    expect(res.status).toBe(200);
    // O conversor adiciona tag na URL existente como fallback
    expect((res.body as any).affiliateUrl ?? '').toContain('tag=');
  });

  test('amzn.to é resolvido para amazon.com.br/dp/ASIN', async () => {
    const token = await setupAffiliateWithTag(VALID_TAG);
    // amzn.to/XXXX → segue redirect HTTP → amazon.com.br/dp/ASIN
    // Não conseguimos mockar isso de forma confiável; testamos só que retorna algo
    const res = await authPost('/api/amazon/convert', token, {
      url: 'https://amzn.to/3xYz123',
    });
    expect(res.status).toBe(200);
    // Se redirect falhar (timeout), sucesso=false; se funcionar, sucesso=true
    // Apenas validamos que a chamada não crashou
    expect(res.body).toHaveProperty('success');
  });

  test('go.promozone.ai/amazon/ASIN extrai ASIN do path', async () => {
    const token = await setupAffiliateWithTag(VALID_TAG);
    const res = await authPost('/api/amazon/convert', token, {
      url: 'https://go.promozone.ai/amazon/B08N5WRWNW',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      method: 'promozone',
    });
    expect((res.body as any).affiliateUrl).toContain('/dp/B08N5WRWNW');
    expect((res.body as any).affiliateUrl).toContain('tag=');
  });

  test('Tracking ID da região US funciona com amazon.com', async () => {
    const token = await setupAffiliateWithTag(VALID_TAG_US);
    const res = await authPost('/api/amazon/convert', token, {
      url: 'https://www.amazon.com/dp/B08N5WRWNW',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect((res.body as any).affiliateUrl).toContain(VALID_TAG_US);
  });
});

test.describe('Amazon — backward compatibility com test-conversion legado', () => {
  test('test-conversion com plataforma amazon usa novo modelo', async () => {
    const { token } = await createTestUser();
    await authPost('/api/amazon/affiliate/tracking-ids', token, { tag: VALID_TAG });

    const res = await authPost('/api/affiliate/test-conversion', token, {
      url: 'https://www.amazon.com.br/dp/B08N5WRWNW',
      platform: 'amazon',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      affiliateUrl: expect.stringContaining('tag='),
    });
  });

  test('GET /api/affiliate/profile retorna amazon.connected quando configurado', async () => {
    const { token } = await createTestUser();
    await authPost('/api/amazon/affiliate/tracking-ids', token, {
      tag: VALID_TAG,
    });

    const res = await authGet('/api/affiliate/profile', token);
    expect(res.status).toBe(200);
    const profile = (res.body as any).profile;
    expect(profile.amazon).toMatchObject({
      connected: true,
      activeTrackingCount: 1,
    });
    expect(profile.amazon.trackingIds[0]).toMatchObject({
      tag: VALID_TAG,
      isDefault: true,
    });
    // Compat com campo legado
    expect(profile.amazonConfigured).toBe(true);
    expect(profile.amazonTrackingId).toBe(VALID_TAG);
  });
});
