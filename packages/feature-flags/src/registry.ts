/**
 * Registry de feature flags — definições legíveis por humanos.
 *
 * Cada flag tem:
 *  - key: identificador único no banco omestre.feature_flags
 *  - label: nome amigável PT-BR para exibição na UI
 *  - description: explicação do que a flag controla (PT-BR)
 *  - defaultEnabled: valor padrão quando não há linha no banco
 *  - danger: se true, UI pede confirmação extra antes de alterar
 *  - category: agrupamento visual na UI (opcional)
 */

export const ALL_FLAG_KEYS = ['maintenance_mode', 'evolution_send_enabled'] as const;
export type FlagKey = (typeof ALL_FLAG_KEYS)[number];

export interface FlagDefinition {
  key: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  danger: boolean;
  category?: string;
}

export const FLAGS: Record<string, FlagDefinition> = {
  maintenance_mode: {
    key: 'maintenance_mode',
    label: 'Modo Manutenção',
    description:
      'Quando ativado, bloqueia o acesso de usuários comuns à plataforma. Apenas administradores conseguem navegar. Use para deploy, migração ou emergência.',
    defaultEnabled: false,
    danger: true,
    category: 'Sistema',
  },
  evolution_send_enabled: {
    key: 'evolution_send_enabled',
    label: 'Envio Evolution',
    description:
      'Quando desativado, o Dispatcher para de enviar mensagens via Evolution API. Mensagens continuam na fila Redis e são enviadas quando a flag for reativada.',
    defaultEnabled: true,
    danger: false,
    category: 'Envio',
  },
};
