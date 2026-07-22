/**
 * Schema da tabela de espelhamentos (mirrors).
 *
 * Cada espelhamento representa uma configuração de mirror entre grupos
 * de origem (grupos de ofertas) e grupos de destino (grupos do afiliado),
 * com template de mensagem personalizável.
 *
 * Desacoplado da tabela affiliates para permitir múltiplos espelhamentos
 * por usuário/afiliado.
 */
import {
  integer,
  jsonb,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { omestre } from './omestre.ts';
import { users } from './users.ts';

export const mirrors = omestre.table('mirrors', {
  id: serial('id').primaryKey(),

  // Nome amigável do espelhamento (ex: "Ofertas Gerais → Afiliados")
  name: text('name').notNull(),

  // Status: active | inactive
  status: text('status').notNull().default('active'),

  // Vínculo opcional com usuário da plataforma
  userId: integer('user_id').references(() => users.id),

  // Grupos de origem (onde as ofertas são postadas)
  sourceGroups: jsonb('source_groups')
    .$type<{ jid: string; name: string }[]>()
    .default([]),

  // Grupos de destino (para onde as ofertas são espelhadas)
  targetGroups: jsonb('target_groups')
    .$type<{ jid: string; name: string }[]>()
    .default([]),

  // Template da mensagem
  // Placeholders: {texto_original} = texto com link convertido, {link_convertido} = link convertido isolado
  messageTemplate: text('message_template'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
