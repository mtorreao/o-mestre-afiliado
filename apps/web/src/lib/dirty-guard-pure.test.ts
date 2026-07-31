import { describe, expect, test } from 'bun:test';
import {
  EMPTY_SNAPSHOT,
  isFormDirty,
  serializeFormSnapshot,
  type FormSnapshot,
} from './dirty-guard-pure.ts';

const BASE: FormSnapshot = {
  name: 'Ofertas Diárias → Grupo VIP',
  sourceGroups: [{ jid: '120363000000000001@g.us', name: 'Origem A' }],
  targetGroups: [{ jid: '120363000000000002@g.us', name: 'Destino B' }],
  messageTemplate: '',
};

function snapshot(values: FormSnapshot): string {
  return serializeFormSnapshot(values);
}

describe('serializeFormSnapshot', () => {
  test('serializa forma estável e determinística', () => {
    expect(snapshot(BASE)).toBe(snapshot({ ...BASE }));
    expect(snapshot(BASE)).toContain('Ofertas Diárias');
    expect(snapshot(BASE)).toContain('120363000000000001@g.us');
  });

  test('preserva a ordem dos grupos (reordenação muda o snapshot)', () => {
    const reordered: FormSnapshot = {
      ...BASE,
      sourceGroups: [
        { jid: '120363000000000003@g.us', name: 'Origem C' },
        { jid: '120363000000000001@g.us', name: 'Origem A' },
      ],
    };
    const plain: FormSnapshot = {
      ...BASE,
      sourceGroups: [
        { jid: '120363000000000001@g.us', name: 'Origem A' },
        { jid: '120363000000000003@g.us', name: 'Origem C' },
      ],
    };
    expect(snapshot(reordered)).not.toBe(snapshot(plain));
  });
});

describe('isFormDirty', () => {
  test('snapshot nulo → limpo (modo edição aguardando fetch / pós-save)', () => {
    expect(isFormDirty(BASE, null)).toBe(false);
    expect(isFormDirty({ ...BASE, name: 'mudou' }, null)).toBe(false);
  });

  test('form idêntico ao snapshot → limpo', () => {
    expect(isFormDirty(BASE, snapshot(BASE))).toBe(false);
  });

  test('form vazio contra snapshot vazio → limpo (modo criação sem edição)', () => {
    expect(isFormDirty(EMPTY_SNAPSHOT, snapshot(EMPTY_SNAPSHOT))).toBe(false);
  });

  test('name alterado → sujo', () => {
    expect(isFormDirty({ ...BASE, name: 'Outro nome' }, snapshot(BASE))).toBe(true);
  });

  test('sourceGroups alterado → sujo', () => {
    expect(
      isFormDirty(
        { ...BASE, sourceGroups: [{ jid: '120363000000000009@g.us', name: 'Outra' }] },
        snapshot(BASE),
      ),
    ).toBe(true);
  });

  test('targetGroups alterado → sujo', () => {
    expect(
      isFormDirty(
        { ...BASE, targetGroups: [{ jid: '120363000000000009@g.us', name: 'Outra' }] },
        snapshot(BASE),
      ),
    ).toBe(true);
  });

  test('messageTemplate alterado → sujo', () => {
    expect(isFormDirty({ ...BASE, messageTemplate: '{texto_original}' }, snapshot(BASE))).toBe(
      true,
    );
  });

  test('grupo adicionado → sujo', () => {
    const withMore: FormSnapshot = {
      ...BASE,
      sourceGroups: [
        { jid: '120363000000000001@g.us', name: 'Origem A' },
        { jid: '120363000000000003@g.us', name: 'Origem C' },
      ],
    };
    expect(isFormDirty(withMore, snapshot(BASE))).toBe(true);
  });

  test('grupo removido → sujo', () => {
    const base2: FormSnapshot = {
      ...BASE,
      sourceGroups: [
        { jid: '120363000000000001@g.us', name: 'Origem A' },
        { jid: '120363000000000003@g.us', name: 'Origem C' },
      ],
    };
    expect(isFormDirty(BASE, snapshot(base2))).toBe(true);
  });

  test('editar e reverter para o snapshot → limpo de novo', () => {
    const snap = snapshot(BASE);
    const edited = { ...BASE, name: 'Temporário' };
    expect(isFormDirty(edited, snap)).toBe(true);
    expect(isFormDirty(BASE, snap)).toBe(false);
  });
});
