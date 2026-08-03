/**
 * Testes E2E — Pipeline de Espelhamento end-to-end (arquitetura v2)
 *
 * Exercita o caminho COMPLETO da nova arquitetura de 2 filas:
 *
 *   webhook (/webhook/message)
 *     → Queue A (omestre:mirror:raw)
 *     → Ingestor (extrai, resolve, converte, fan-out, publica)
 *     → Queue B (omestre:mirror:send)
 *     → Dispatcher (rate limit, sendMedia/sendText)
 *     → Simulador WhatsApp (registra a mensagem "enviada")
 *
 * MARKETPLACE DE REFERÊNCIA: Amazon.
 *   O conversor Amazon é puro parâmetro de URL (`?tag=`), sem API externa,
 *   sem cookies de sessão nem GraphQL. Isso permite testar o pipeline
 *   completo SEM credenciais secretas — resolvendo a raiz do skip histórico
 *   do teste Shopee (ver docs/known-issues.md).
 *
 * Usa o plano "mirror" do docker-compose.e2e.yml:
 *   - api-e2e-mirror (15447)         — API apontando para o simulador
 *   - whatsapp-simulator-e2e (15446) — substituto da Evolution API
 *   - ingestor-e2e-mirror            — pipeline pesado (Queue A → Queue B)
 *   - dispatcher-e2e-mirror          — envio (Queue B → simulador)
 *
 * Requer que o simulador implemente /message/sendMedia (além de sendText),
 * pois o dispatcher usa sendMedia quando há imagem de capa.
 *
 * ISOLAMENTO: cada teste usa um sourceGroup JID ÚNICO (genSourceJid).
 * Sem isso, o cache 1:N de sourceGroup acumula mirrors de testes
 * anteriores no mesmo JID e o fan-out fica não-determinístico.
 */

import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { createTestUser } from '../../helpers/index.ts';
import {
  resetSimulatorInstance,
  getSimulatorMessagesFor,
  waitForMessagesOnInstance,
} from '../../helpers/index.ts';

const API_MIRROR = process.env.API_MIRROR_URL || 'http://localhost:15447';
const SIMULATOR = process.env.SIMULATOR_URL || 'http://localhost:15446';

// Grupo destino genérico (mockado pelo simulador). O JID é arbitrário:
// o webhook só casa com o cache/DB, e o dispatcher→simulador não valida
// se o grupo existe (o simulador aceita qualquer número).
const TARGET_GROUP = { jid: '120363000000000003@g.us', name: 'Grupo Teste 3' };
const TARGET_GROUP_2 = { jid: '120363000000000002@g.us', name: 'Grupo Teste 2' };

// ASIN válido (10 chars) — produto Amazon fictício mas com formato real
const AMAZON_ASIN = 'B08N5WRWNW';
const AMAZON_URL = `https://www.amazon.com.br/dp/${AMAZON_ASIN}`;
const AMAZON_TAG = 'e2etag-20';

/** Gera um sourceGroup JID único por teste para isolar o cache 1:N. */
function genSourceJid(prefix: string): { jid: string; name: string } {
  const n = Math.floor(Math.random() * 1_000_000_000)
    .toString()
    .padStart(9, '0');
  return { jid: `12036300000000${prefix}${n}@g.us`, name: 'Ofertas Promoções' };
}

// ─── Helpers HTTP ────────────────────────────────────────────────────

async function authPostMirror(path: string, token: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_MIRROR}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function authPutMirror(path: string, token: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_MIRROR}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function authDeleteMirror(path: string, token: string) {
  try {
    await fetch(`${API_MIRROR}${path}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // ignora
  }
}

// ─── Simulador ───────────────────────────────────────────────────────

// ─── Postgres seed (via docker exec) ─────────────────────────────────

function psql(sql: string): void {
  execSync(
    `docker exec omestre_e2e_postgres psql -U evolution -d omestre_db -c "${sql.replace(/"/g, '\\"')}"`,
    { stdio: 'pipe' },
  );
}

/**
 * Insere (ou atualiza) uma linha em omestre.affiliates ligada à instância
 * `user-{userId}`. O Ingestor usa essa linha (via group-cache) para resolver
 * o affiliateId no fan-out, e o Dispatcher para verificar o link.
 */
function seedAffiliate(userId: number, name: string): void {
  const instanceName = `user-${userId}`;
  psql(
    `INSERT INTO omestre.affiliates (name, active, evolution_instance_id) ` +
      `VALUES ('${name}', true, '${instanceName}') ` +
      `ON CONFLICT (evolution_instance_id) DO UPDATE SET active = true, name = EXCLUDED.name`,
  );
}

/**
 * Remove uma chave do Redis E2E via docker exec.
 * Usado para forçar o rebuild 1:N do cache de sourceGroup a partir do banco:
 * o create de mirror sobrescreve o cache com UMA config; ao deletar a chave,
 * o próximo webhook dispara o fallback de DB da API que reconstrói o array
 * completo (todos os mirrors do sourceGroup) — habilitando o fan-out real.
 * O plano "mirror" usa Redis DB 3 (isolado do plano padrão, DB 0).
 */
function redisDel(key: string): void {
  execSync(`docker exec omestre_e2e_redis redis-cli -n 3 DEL "${key}"`, { stdio: 'pipe' });
}

// ─── Seed completo de um afiliado Amazon pronto para espelhar ────────

interface SeededMirror {
  token: string;
  userId: number;
  instanceName: string;
  mirrorId: number;
  sourceGroup: { jid: string; name: string };
}

async function seedAmazonMirror(opts: {
  affiliateName: string;
  targetGroup: { jid: string; name: string };
  status?: string;
  sourceGroup: { jid: string; name: string };
}): Promise<SeededMirror> {
  const { token, user } = await createTestUser(API_MIRROR);
  const instanceName = `user-${user.id}`;

  // 1. Conecta WhatsApp (simulador aceita sempre)
  await authPostMirror('/api/whatsapp/connect', token, {});

  // 2. Afiliado Amazon + tracking ID ativo (cria o afiliado no primeiro POST)
  const trk = await authPostMirror('/api/amazon/affiliate/tracking-ids', token, {
    tag: AMAZON_TAG,
    label: 'E2E',
    region: 'BR',
    active: true,
    isDefault: true,
  });
  expect(trk.body.success).toBe(true);

  // 3. Linha em omestre.affiliates para o group-cache resolver o affiliateId
  seedAffiliate(user.id, opts.affiliateName);

  // 4. Mirror ativo — popula o cache Redis sourceGroup → config
  const mirrorRes = await authPostMirror('/api/mirrors', token, {
    name: opts.affiliateName,
    sourceGroups: [opts.sourceGroup],
    targetGroups: [opts.targetGroup],
    status: opts.status ?? 'active',
  });
  expect(mirrorRes.body.success).toBe(true);
  const mirror = mirrorRes.body.mirror as { id: number };

  return {
    token,
    userId: user.id,
    instanceName,
    mirrorId: mirror.id,
    sourceGroup: opts.sourceGroup,
  };
}

// ─── Webhook payload builder ─────────────────────────────────────────

function offerWebhook(opts: {
  messageId: string;
  instance: string;
  url?: string;
  text?: string;
  fromMe?: boolean;
  groupJid?: string;
}) {
  const body = opts.text ?? `🔥 Oferta imperdível na Amazon!\n\nConfira: ${opts.url ?? AMAZON_URL}`;
  return {
    event: 'messages.upsert',
    instance: opts.instance,
    data: [
      {
        key: {
          id: opts.messageId,
          remoteJid: opts.groupJid ?? '120363000000000001@g.us',
          fromMe: opts.fromMe ?? false,
        },
        message: { conversation: body },
        messageTimestamp: Math.floor(Date.now() / 1000),
        pushName: 'Test E2E',
      },
    ],
  };
}

async function postWebhook(payload: unknown): Promise<Response> {
  return await fetch(`${API_MIRROR}/webhook/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Segurança #3: webhook exige apikey válida (EVOLUTION_API_KEY do E2E)
      apikey: 'e2e-evolution-api-key',
    },
    body: JSON.stringify(payload),
  });
}

// ─── P1: Oferta Amazon chega ao destino ──────────────────────────────

test.describe('Pipeline v2 — Amazon end-to-end', () => {
  // Antes: test.beforeEach com resetSimulator() global — quebrava paralelismo (workers=2)
  // colidiam no estado do simulador. Agora: cada teste chama resetSimulatorInstance
  // (escopo por instanceName) logo apos seedAmazonMirror/seedMagaluMirror.

  // EXPERIMENTO workers=2: este teste depende do estado global do simulador (sentMessages);
  // com workers=2 ele colide com mirror-flow que reseta/usa o mesmo state. Validar 1-a-1 depois.
  test('P1 — Oferta Amazon é convertida e enviada ao grupo destino', async () => {
    const sourceGroup = genSourceJid('p1');
    const { instanceName, token } = await seedAmazonMirror({
      affiliateName: 'E2E Amazon P1',
      targetGroup: TARGET_GROUP,
      sourceGroup,
    });
    await resetSimulatorInstance(instanceName);

    const messageId = `e2e_amz_p1_${Date.now()}`;
    const res = await postWebhook(
      offerWebhook({ messageId, instance: instanceName, groupJid: sourceGroup.jid }),
    );
    expect(res.status).toBe(200);

    // Aguarda a mensagem aparecer no simulador (enviada ao grupo destino)
    const msgs = await waitForMessagesOnInstance(instanceName, (m) =>
      m.some((x) => x.number === TARGET_GROUP.jid && x.text.includes(`tag=${AMAZON_TAG}`)),
    );

    const sent = msgs.find((m) => m.number === TARGET_GROUP.jid);
    expect(
      sent,
      `Nenhuma mensagem enviada ao destino. Recebidas: ${JSON.stringify(msgs)}`,
    ).toBeDefined();
    expect(sent!.text).toContain('amazon.com.br');
    expect(sent!.text).toContain(`tag=${AMAZON_TAG}`);
    expect(sent!.text).not.toContain('undefined');

    await authDeleteMirror('/api/whatsapp/disconnect', token);
  });

  test('P2 — Fallback imagem→texto: oferta sem imagem ainda é enviada', async () => {
    // fetchProductImage para Amazon fictícia falha (produto não existe) →
    // o Ingestor deve enviar como TEXTO (imageUrl=''), não bloquear.
    const sourceGroup = genSourceJid('p2');
    const { instanceName } = await seedAmazonMirror({
      affiliateName: 'E2E Amazon P2',
      targetGroup: TARGET_GROUP,
      sourceGroup,
    });
    await resetSimulatorInstance(instanceName);

    const messageId = `e2e_amz_p2_${Date.now()}`;
    await postWebhook(
      offerWebhook({ messageId, instance: instanceName, groupJid: sourceGroup.jid }),
    );

    const msgs = await waitForMessagesOnInstance(instanceName, (m) =>
      m.some((x) => x.number === TARGET_GROUP.jid),
    );
    const sent = msgs.find((m) => m.number === TARGET_GROUP.jid);
    expect(sent, 'Oferta sem imagem deveria ter sido enviada como texto').toBeDefined();
    expect(sent!.text).toContain(`tag=${AMAZON_TAG}`);
  });

  // EXPERIMENTO workers=2: este teste depende do estado global do simulador (sentMessages);
  // com workers=2 ele colide com mirror-flow que reseta/usa o mesmo state. Validar 1-a-1 depois.
  test('P3 — Fan-out 1:N: 2 mirrors no mesmo sourceGroup geram 2 envios', async () => {
    const sourceGroup = genSourceJid('p3');
    const a = await seedAmazonMirror({
      affiliateName: 'E2E Amazon Fanout A',
      targetGroup: TARGET_GROUP,
      sourceGroup,
    });
    await resetSimulatorInstance(a.instanceName);
    // Segundo afiliado, instância diferente, MESMO sourceGroup, destino diferente
    const b = await seedAmazonMirror({
      affiliateName: 'E2E Amazon Fanout B',
      targetGroup: TARGET_GROUP_2,
      sourceGroup,
    });
    await resetSimulatorInstance(b.instanceName);

    // O webhook chega por UMA instância; o Ingestor faz fan-out via cache 1:N.
    // O create de mirror sobrescreve o cache com 1 config por vez, então
    // limpamos a chave para forçar o rebuild completo (2 configs) a partir do
    // banco no próximo webhook (fallback de DB da API).
    redisDel(`mirror:source-group:${sourceGroup.jid}`);

    const messageId = `e2e_amz_p3_${Date.now()}`;
    await postWebhook(
      offerWebhook({ messageId, instance: a.instanceName, groupJid: sourceGroup.jid }),
    );

    // P3 eh fan-out 1:N: a API envia 1 webhook mas o ingestor despacha para
    // os 2 mirrors (a e b). Cada mirror tem seu proprio instanceName, entao
    // precisamos inspecionar AMBAS as instancias do simulador para validar.
    const [msgsA, msgsB] = await Promise.all([
      waitForMessagesOnInstance(a.instanceName, (m) =>
        m.some((x) => x.number === TARGET_GROUP.jid),
      ),
      waitForMessagesOnInstance(b.instanceName, (m) =>
        m.some((x) => x.number === TARGET_GROUP_2.jid),
      ),
    ]);

    expect(
      msgsA.filter((m) => m.number === TARGET_GROUP.jid).length,
      `esperava envio ao destino A. msgs=${JSON.stringify(msgsA)}`,
    ).toBeGreaterThanOrEqual(1);
    expect(
      msgsB.filter((m) => m.number === TARGET_GROUP_2.jid).length,
      `esperava envio ao destino B. msgs=${JSON.stringify(msgsB)}`,
    ).toBeGreaterThanOrEqual(1);

    await authDeleteMirror('/api/whatsapp/disconnect', a.token);
    await authDeleteMirror('/api/whatsapp/disconnect', b.token);
  });

  // EXPERIMENTO workers=2: este teste depende do estado global do simulador (sentMessages);
  // com workers=2 ele colide com mirror-flow que reseta/usa o mesmo state. Validar 1-a-1 depois.
  test('P4 — Dedup webhook: 2 webhooks com mesmo messageId geram 1 envio', async () => {
    const sourceGroup = genSourceJid('p4');
    const { instanceName } = await seedAmazonMirror({
      affiliateName: 'E2E Amazon Dedup',
      targetGroup: TARGET_GROUP,
      sourceGroup,
    });
    await resetSimulatorInstance(instanceName);

    const messageId = `e2e_amz_p4_${Date.now()}`;
    // Duas instâncias diferentes disparam o webhook para a MESMA mensagem
    // (mesmo remoteJid + messageId). O dedup global (30s) na API deve
    // publicar apenas 1 RawMessageEvent na Queue A.
    await postWebhook(
      offerWebhook({ messageId, instance: instanceName, groupJid: sourceGroup.jid }),
    );
    await postWebhook(
      offerWebhook({ messageId, instance: 'user-99999', groupJid: sourceGroup.jid }),
    );

    // Aguarda o primeiro envio chegar
    await waitForMessagesOnInstance(instanceName, (m) =>
      m.some((x) => x.number === TARGET_GROUP.jid),
    );
    // Dá tempo para um eventual segundo envio (não deveria acontecer)
    await new Promise((r) => setTimeout(r, 4000));

    const msgs = await getSimulatorMessagesFor(instanceName);
    const toTarget = msgs.filter((m) => m.number === TARGET_GROUP.jid);
    expect(toTarget.length, `dedup falhou — ${toTarget.length} envios`).toBe(1);
  });

  // EXPERIMENTO workers=2: este teste depende do estado global do simulador (sentMessages);
  // com workers=2 ele colide com mirror-flow que reseta/usa o mesmo state. Validar 1-a-1 depois.
  test('P5 — Dedup send-completed: reenvio do mesmo messageId não duplica', async () => {
    const sourceGroup = genSourceJid('p5');
    const { instanceName } = await seedAmazonMirror({
      affiliateName: 'E2E Amazon SendDedup',
      targetGroup: TARGET_GROUP,
      sourceGroup,
    });
    await resetSimulatorInstance(instanceName);

    const messageId = `e2e_amz_p5_${Date.now()}`;
    await postWebhook(
      offerWebhook({ messageId, instance: instanceName, groupJid: sourceGroup.jid }),
    );
    await waitForMessagesOnInstance(instanceName, (m) =>
      m.some((x) => x.number === TARGET_GROUP.jid),
    );

    // Reenvia o MESMO messageId após o primeiro envio já ter sido concluído.
    // O send-dedup (Dispatcher, 24h) evita reenvio ao grupo destino.
    await new Promise((r) => setTimeout(r, 1500));
    await postWebhook(
      offerWebhook({ messageId, instance: instanceName, groupJid: sourceGroup.jid }),
    );
    await new Promise((r) => setTimeout(r, 4000));

    const msgs = await getSimulatorMessagesFor(instanceName);
    const toTarget = msgs.filter((m) => m.number === TARGET_GROUP.jid);
    expect(toTarget.length, `send-completed falhou — ${toTarget.length} envios`).toBe(1);
  });

  test('P6 — Mirror inativo: oferta é descartada (nenhum envio)', async () => {
    const sourceGroup = genSourceJid('p6');
    const { instanceName, token, mirrorId } = await seedAmazonMirror({
      affiliateName: 'E2E Amazon Inactive',
      targetGroup: TARGET_GROUP,
      sourceGroup,
    });
    await resetSimulatorInstance(instanceName);

    // Desativa o mirror APÓS o cache ter sido populado com status active.
    // O Dispatcher resolve a config do mirror e descarta se status=inactive.
    await authPutMirror(`/api/mirrors/${mirrorId}`, token, { status: 'inactive' });

    const messageId = `e2e_amz_p6_${Date.now()}`;
    await postWebhook(
      offerWebhook({ messageId, instance: instanceName, groupJid: sourceGroup.jid }),
    );

    await new Promise((r) => setTimeout(r, 6000));
    const msgs = await getSimulatorMessagesFor(instanceName);
    const toTarget = msgs.filter((m) => m.number === TARGET_GROUP.jid);
    expect(toTarget.length, `mirror inativo não deveria enviar — ${toTarget.length}`).toBe(0);
  });
});

// ─── Casos negativos (mantidos/consolidados) ─────────────────────────

test.describe('Pipeline v2 — Casos negativos', () => {
  // Antes: test.beforeEach com resetSimulator() global — quebrava paralelismo (workers=2)
  // colidiam no estado do simulador. Agora: cada teste chama resetSimulatorInstance
  // (escopo por instanceName) logo apos seedAmazonMirror/seedMagaluMirror.

  test('P7 — Mensagem sem link de marketplace é ignorada', async () => {
    const sourceGroup = genSourceJid('p7');
    const { instanceName } = await seedAmazonMirror({
      affiliateName: 'E2E Neg NoLink',
      targetGroup: TARGET_GROUP,
      sourceGroup,
    });
    await resetSimulatorInstance(instanceName);

    await postWebhook(
      offerWebhook({
        messageId: `e2e_neg_nolink_${Date.now()}`,
        instance: instanceName,
        groupJid: sourceGroup.jid,
        text: 'Bom dia pessoal! Tudo bem?',
      }),
    );

    await new Promise((r) => setTimeout(r, 4000));
    const msgs = await getSimulatorMessagesFor(instanceName);
    expect(msgs.filter((m) => m.number === TARGET_GROUP.jid).length).toBe(0);
  });

  test('P8 — Mensagem de grupo não-source é ignorada', async () => {
    const sourceGroup = genSourceJid('p8');
    const { instanceName } = await seedAmazonMirror({
      affiliateName: 'E2E Neg UnknownGroup',
      targetGroup: TARGET_GROUP,
      sourceGroup,
    });
    await resetSimulatorInstance(instanceName);

    await postWebhook(
      offerWebhook({
        messageId: `e2e_neg_unknown_${Date.now()}`,
        instance: instanceName,
        groupJid: '120363999999999999@g.us',
      }),
    );

    await new Promise((r) => setTimeout(r, 4000));
    const msgs = await getSimulatorMessagesFor(instanceName);
    expect(msgs.filter((m) => m.number === TARGET_GROUP.jid).length).toBe(0);
  });

  // EXPERIMENTO workers=2: este teste depende do estado global do simulador (sentMessages);
  // com workers=2 ele colide com mirror-flow que reseta/usa o mesmo state. Validar 1-a-1 depois.
  test('P9 — Mensagem fromMe é ignorada', async () => {
    const sourceGroup = genSourceJid('p9');
    const { instanceName } = await seedAmazonMirror({
      affiliateName: 'E2E Neg FromMe',
      targetGroup: TARGET_GROUP,
      sourceGroup,
    });
    await resetSimulatorInstance(instanceName);

    await postWebhook(
      offerWebhook({
        messageId: `e2e_neg_fromme_${Date.now()}`,
        instance: instanceName,
        groupJid: sourceGroup.jid,
        fromMe: true,
      }),
    );

    await new Promise((r) => setTimeout(r, 4000));
    const msgs = await getSimulatorMessagesFor(instanceName);
    expect(msgs.filter((m) => m.number === TARGET_GROUP.jid).length).toBe(0);
  });
});

// ─── P11: Oferta Magalu chega ao destino ───────────────────────────

const MAGALU_PRODUCT_ID = '123';
const MAGALU_PRODUCT_URL = `https://www.magazineluiza.com.br/celular-x/p/${MAGALU_PRODUCT_ID}/`;
const MAGALU_SLUG = 'e2emagazinevoce';

async function seedMagaluMirror(opts: {
  affiliateName: string;
  targetGroup: { jid: string; name: string };
  sourceGroup: { jid: string; name: string };
}): Promise<SeededMirror> {
  const { token, user } = await createTestUser(API_MIRROR);
  const instanceName = `user-${user.id}`;

  // 1. Conecta WhatsApp (simulador aceita sempre)
  await authPostMirror('/api/whatsapp/connect', token, {});

  // 2. Afiliado Magalu + storeSlug ativo (cria o afiliado no primeiro PUT)
  const put = await authPutMirror('/api/magalu/affiliate', token, {
    nickname: opts.affiliateName,
    storeSlug: MAGALU_SLUG,
  });
  expect(put.body.success).toBe(true);

  // 3. Linha em omestre.affiliates para o group-cache resolver o affiliateId
  seedAffiliate(user.id, opts.affiliateName);

  // 4. Mirror ativo — popula o cache Redis sourceGroup → config
  const mirrorRes = await authPostMirror('/api/mirrors', token, {
    name: opts.affiliateName,
    sourceGroups: [opts.sourceGroup],
    targetGroups: [opts.targetGroup],
    status: 'active',
  });
  expect(mirrorRes.body.success).toBe(true);
  const mirror = mirrorRes.body.mirror as { id: number };

  return {
    token,
    userId: user.id,
    instanceName,
    mirrorId: mirror.id,
    sourceGroup: opts.sourceGroup,
  };
}

function magaluOfferWebhook(opts: {
  messageId: string;
  instance: string;
  groupJid: string;
  url?: string;
}): unknown {
  const url = opts.url ?? MAGALU_PRODUCT_URL;
  return {
    event: 'messages.upsert',
    instance: opts.instance,
    data: [
      {
        key: {
          id: opts.messageId,
          remoteJid: opts.groupJid,
          fromMe: false,
        },
        message: {
          conversation: `🔥 Oferta imperdível na Magalu!\n\nConfira: ${url}`,
        },
        messageTimestamp: Math.floor(Date.now() / 1000),
        pushName: 'Test E2E',
      },
    ],
  };
}

test.describe('Pipeline v2 — Magalu end-to-end', () => {
  // Antes: test.beforeEach com resetSimulator() global — quebrava paralelismo (workers=2)
  // colidiam no estado do simulador. Agora: cada teste chama resetSimulatorInstance
  // (escopo por instanceName) logo apos seedAmazonMirror/seedMagaluMirror.

  test('P11 — Oferta Magalu /p/{id} é convertida e enviada ao grupo destino', async () => {
    const sourceGroup = genSourceJid('p11');
    const { instanceName, token } = await seedMagaluMirror({
      affiliateName: 'E2E Magalu P11',
      targetGroup: TARGET_GROUP,
      sourceGroup,
    });
    await resetSimulatorInstance(instanceName);

    const messageId = `e2e_mag_p11_${Date.now()}`;
    const res = await postWebhook(
      magaluOfferWebhook({ messageId, instance: instanceName, groupJid: sourceGroup.jid }),
    );
    expect(res.status).toBe(200);

    // Aguarda a mensagem aparecer no simulador (enviada ao grupo destino)
    const msgs = await waitForMessagesOnInstance(instanceName, (m) =>
      m.some(
        (x) =>
          x.number === TARGET_GROUP.jid && x.text.includes(`magazinevoce.com.br/${MAGALU_SLUG}/`),
      ),
    );

    const sent = msgs.find((m) => m.number === TARGET_GROUP.jid);
    expect(
      sent,
      `Nenhuma mensagem enviada ao destino. Recebidas: ${JSON.stringify(msgs)}`,
    ).toBeDefined();
    // A URL afiliada deve apontar para a loja do afiliado de teste
    expect(sent!.text).toContain(`magazinevoce.com.br/${MAGALU_SLUG}/`);
    // E preservar o ID do produto Magalu original
    expect(sent!.text).toContain(`/p/${MAGALU_PRODUCT_ID}/`);
    // Não pode ter ficado com slug de outra loja (URL original) ou com placeholder
    expect(sent!.text).not.toContain('undefined');

    await authDeleteMirror('/api/whatsapp/disconnect', token);
  });
});
