import { describe, expect, it } from 'bun:test';
import { filterWhatsAppGroupsByAdmin } from './whatsapp-groups-pure.ts';

const groups = [
  { jid: 'admin@g.us', name: 'Administrado', isAdmin: true },
  { jid: 'member@g.us', name: 'Somente membro', isAdmin: false },
];

describe('filterWhatsAppGroupsByAdmin', () => {
  it('mantém todos os grupos para o campo de origem', () => {
    expect(filterWhatsAppGroupsByAdmin(groups, false)).toEqual(groups);
  });

  it('mantém somente grupos administrados para o campo de destino', () => {
    expect(filterWhatsAppGroupsByAdmin(groups, true)).toEqual([groups[0]!]);
  });
});
