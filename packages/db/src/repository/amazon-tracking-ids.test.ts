/**
 * Testes das funções PURAS de manipulação de tracking IDs da Amazon.
 *
 * Cobrem 100% da lógica de negócio (adicionar/remover/atualizar/consultar)
 * sem precisar de PostgreSQL. A camada de I/O vive em
 * `amazonAffiliates.repository.ts`, que apenas orquestra estas funções.
 */
import { describe, expect, it } from 'bun:test';
import type { AmazonTrackingId } from '../schema/index.ts';
import {
  detectRegion,
  buildTrackingId,
  addTrackingIdPure,
  removeTrackingIdPure,
  updateTrackingIdPure,
  getDefaultTrackingIdPure,
  getActiveTrackingIdPure,
  toAmazonSummary,
  MAX_TRACKING_IDS,
} from './amazon-tracking-ids.ts';

// ─── Helpers ──────────────────────────────────────────────────────────

function tid(tag: string, over: Partial<AmazonTrackingId> = {}): AmazonTrackingId {
  return {
    tag,
    region: detectRegion(tag),
    active: true,
    isDefault: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...over,
  };
}

// ─── detectRegion ─────────────────────────────────────────────────────

describe('detectRegion', () => {
  it('detecta -20 como BR', () => expect(detectRegion('meusite-20')).toBe('BR'));
  it('detecta -21 como UK', () => expect(detectRegion('meusite-21')).toBe('UK'));
  it('detecta -22 como JP', () => expect(detectRegion('meusite-22')).toBe('JP'));
  it('retorna OTHER para tag vazia', () => expect(detectRegion('')).toBe('OTHER'));
  it('retorna OTHER para sufixo desconhecido', () =>
    expect(detectRegion('meusite-99')).toBe('OTHER'));
});

// ─── buildTrackingId ──────────────────────────────────────────────────

describe('buildTrackingId', () => {
  it('deriva região do sufixo quando não informada', () => {
    const t = buildTrackingId({ tag: 'x-20' }, [], () => 'now');
    expect(t.region).toBe('BR');
  });

  it('usa região explícita quando informada', () => {
    const t = buildTrackingId({ tag: 'x-20', region: 'JP' }, [], () => 'now');
    expect(t.region).toBe('JP');
  });

  it('primeiro ID vira default automaticamente', () => {
    const t = buildTrackingId({ tag: 'a-20' }, [], () => 'now');
    expect(t.isDefault).toBe(true);
  });

  it('IDs seguintes não são default por padrão', () => {
    const t = buildTrackingId({ tag: 'b-20' }, [tid('a-20', { isDefault: true })], () => 'now');
    expect(t.isDefault).toBe(false);
  });

  it('isDefault explícito false respeita o informado', () => {
    const t = buildTrackingId(
      { tag: 'b-20', isDefault: false },
      [tid('a-20', { isDefault: true })],
      () => 'now',
    );
    expect(t.isDefault).toBe(false);
  });

  it('active padrão é true', () => {
    const t = buildTrackingId({ tag: 'a-20' }, [], () => 'now');
    expect(t.active).toBe(true);
  });

  it('usa createdAt do now()', () => {
    const t = buildTrackingId({ tag: 'a-20' }, [], () => 'fixed-ts');
    expect(t.createdAt).toBe('fixed-ts');
  });
});

// ─── addTrackingIdPure ────────────────────────────────────────────────

describe('addTrackingIdPure', () => {
  it('adiciona um ID e promove o primeiro a default', () => {
    const out = addTrackingIdPure([], { tag: 'a-20' }, () => 'now');
    expect(out).toHaveLength(1);
    expect(out[0]!.isDefault).toBe(true);
  });

  it('não marca default em IDs seguintes', () => {
    const out = addTrackingIdPure([tid('a-20', { isDefault: true })], { tag: 'b-20' }, () => 'now');
    expect(out).toHaveLength(2);
    expect(out[0]!.isDefault).toBe(true);
    expect(out[1]!.isDefault).toBe(false);
  });

  it('não muta o array original', () => {
    const original = [tid('a-20')];
    addTrackingIdPure(original, { tag: 'b-20' }, () => 'now');
    expect(original).toHaveLength(1);
  });

  it('lança erro ao exceder MAX_TRACKING_IDS', () => {
    const full: AmazonTrackingId[] = Array.from({ length: MAX_TRACKING_IDS }, (_, i) =>
      tid(`id${i}-20`),
    );
    expect(() => addTrackingIdPure(full, { tag: 'extra-20' }, () => 'now')).toThrow(
      /Limite de 100/,
    );
  });

  it('aceita exatamente MAX_TRACKING_IDS sem erro', () => {
    const full: AmazonTrackingId[] = Array.from({ length: MAX_TRACKING_IDS - 1 }, (_, i) =>
      tid(`id${i}-20`),
    );
    const out = addTrackingIdPure(full, { tag: 'last-20' }, () => 'now');
    expect(out).toHaveLength(MAX_TRACKING_IDS);
  });
});

// ─── removeTrackingIdPure ─────────────────────────────────────────────

describe('removeTrackingIdPure', () => {
  it('remove um ID existente', () => {
    const out = removeTrackingIdPure([tid('a-20'), tid('b-20')], 'a-20');
    expect(out.map((t) => t.tag)).toEqual(['b-20']);
  });

  it('retorna o mesmo array (referência) quando tag não existe', () => {
    const original = [tid('a-20')];
    const out = removeTrackingIdPure(original, 'zzz');
    expect(out).toBe(original);
  });

  it('não muta o array original', () => {
    const original = [tid('a-20'), tid('b-20')];
    removeTrackingIdPure(original, 'a-20');
    expect(original).toHaveLength(2);
  });

  it('promove primeiro ativo a default ao remover o default', () => {
    const out = removeTrackingIdPure(
      [tid('a-20', { isDefault: true }), tid('b-20', { active: true })],
      'a-20',
    );
    expect(out[0]!.isDefault).toBe(true); // b-20 promovido
  });

  it('não promove se não havia default removido', () => {
    const out = removeTrackingIdPure(
      [tid('a-20', { isDefault: true }), tid('b-20', { active: true, isDefault: false })],
      'b-20',
    );
    expect(out.find((t) => t.tag === 'a-20')!.isDefault).toBe(true);
  });

  it('não quebra quando não há ativo para promover', () => {
    const out = removeTrackingIdPure([tid('a-20', { isDefault: true, active: false })], 'a-20');
    expect(out).toHaveLength(0);
  });
});

// ─── updateTrackingIdPure ─────────────────────────────────────────────

describe('updateTrackingIdPure', () => {
  it('atualiza label e active', () => {
    const out = updateTrackingIdPure([tid('a-20')], 'a-20', { label: 'Novo', active: false });
    expect(out[0]!.label).toBe('Novo');
    expect(out[0]!.active).toBe(false);
  });

  it('desmarca os outros ao marcar isDefault true', () => {
    const out = updateTrackingIdPure(
      [tid('a-20', { isDefault: true }), tid('b-20', { isDefault: false })],
      'b-20',
      { isDefault: true },
    );
    expect(out.find((t) => t.tag === 'a-20')!.isDefault).toBe(false);
    expect(out.find((t) => t.tag === 'b-20')!.isDefault).toBe(true);
  });

  it('retorna o mesmo array quando tag não existe', () => {
    const original = [tid('a-20')];
    const out = updateTrackingIdPure(original, 'zzz', { active: false });
    expect(out).toBe(original);
  });

  it('não muta o array original', () => {
    const original = [tid('a-20', { active: true })];
    updateTrackingIdPure(original, 'a-20', { active: false });
    expect(original[0]!.active).toBe(true);
  });

  it('preserva tag e createdAt (imutáveis)', () => {
    const out = updateTrackingIdPure([tid('a-20')], 'a-20', { label: 'X' });
    expect(out[0]!.tag).toBe('a-20');
    expect(out[0]!.createdAt).toBe('2024-01-01T00:00:00.000Z');
  });
});

// ─── getDefaultTrackingIdPure ─────────────────────────────────────────

describe('getDefaultTrackingIdPure', () => {
  it('retorna tag do default ativo', () => {
    expect(getDefaultTrackingIdPure([tid('a-20', { isDefault: true })])).toBe('a-20');
  });

  it('retorna null quando o único default está inativo (sem promoção automática)', () => {
    // O comportamento é: procura um ID que seja isDefault E active.
    // Se o default está inativo, não há default válido → null.
    const ids = [tid('a-20', { isDefault: true, active: false }), tid('b-20', { active: true })];
    expect(getDefaultTrackingIdPure(ids)).toBeNull();
  });

  it('retorna null sem default ativo', () => {
    expect(getDefaultTrackingIdPure([tid('a-20', { active: true })])).toBeNull();
  });

  it('retorna null para array vazio/nulo', () => {
    expect(getDefaultTrackingIdPure([])).toBeNull();
    expect(getDefaultTrackingIdPure(null)).toBeNull();
    expect(getDefaultTrackingIdPure(undefined)).toBeNull();
  });
});

// ─── getActiveTrackingIdPure ──────────────────────────────────────────

describe('getActiveTrackingIdPure', () => {
  it('retorna tag quando ativo', () => {
    expect(getActiveTrackingIdPure([tid('a-20')], 'a-20')).toBe('a-20');
  });

  it('retorna null quando inativo', () => {
    expect(getActiveTrackingIdPure([tid('a-20', { active: false })], 'a-20')).toBeNull();
  });

  it('retorna null quando tag inexistente', () => {
    expect(getActiveTrackingIdPure([tid('a-20')], 'zzz')).toBeNull();
  });

  it('retorna null para array nulo', () => {
    expect(getActiveTrackingIdPure(null, 'a-20')).toBeNull();
  });
});

// ─── toAmazonSummary ──────────────────────────────────────────────────

describe('toAmazonSummary', () => {
  const affiliate = {
    id: 1,
    userId: 99,
    nickname: 'Matheus',
    trackingIds: [tid('a-20', { active: true }), tid('b-20', { active: false })],
    active: true,
    connectedAt: new Date('2024-01-01'),
    lastUsedAt: new Date('2024-02-01'),
  } as any;

  it('conta apenas tracking IDs ativos', () => {
    const s = toAmazonSummary(affiliate);
    expect(s.activeTrackingCount).toBe(1);
  });

  it('preserva campos do afiliado', () => {
    const s = toAmazonSummary(affiliate);
    expect(s.id).toBe(1);
    expect(s.userId).toBe(99);
    expect(s.nickname).toBe('Matheus');
    expect(s.active).toBe(true);
    expect(s.trackingIds).toHaveLength(2);
  });

  it('trata trackingIds nulo como vazio', () => {
    const s = toAmazonSummary({ ...affiliate, trackingIds: null });
    expect(s.activeTrackingCount).toBe(0);
    expect(s.trackingIds).toEqual([]);
  });
});
