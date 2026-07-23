/**
 * PlaceholderPicker — Botões de inserção de placeholders no template.
 *
 * Agrupados por categoria:
 *   Texto: {texto_original}
 *   Link:  {link_convertido}, {link_original}
 *   Meta:  {marketplace}, {marketplace_nome}, {source_group}, {target_group},
 *          {data}, {hora}, {data_hora}
 *   Condicional: {? marketplace = shopee}
 *
 * Cada botão insere o placeholder na posição do cursor do textarea alvo.
 */
import { useRef } from 'react';
import { Code, Link, Hash, GitBranch } from 'lucide-react';

interface PlaceholderPickerProps {
  /** Ref para o textarea onde o placeholder será inserido */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Callback chamado após inserir, para notificar mudança no valor */
  onInsert: (newValue: string) => void;
  /** Valor atual do textarea (para reconstruir após inserção) */
  currentValue: string;
}

// ─── Grupos de placeholders ──────────────────────────────────────────

interface PlaceholderGroup {
  category: string;
  icon: React.ReactNode;
  items: { label: string; placeholder: string; hint: string }[];
}

const GROUPS: PlaceholderGroup[] = [
  {
    category: 'Texto',
    icon: <Code size={13} />,
    items: [
      { label: '{texto_original}', placeholder: '{texto_original}', hint: 'Texto com link convertido' },
    ],
  },
  {
    category: 'Link',
    icon: <Link size={13} />,
    items: [
      { label: '{link_convertido}', placeholder: '{link_convertido}', hint: 'Link de afiliado' },
      { label: '{link_original}', placeholder: '{link_original}', hint: 'URL original' },
    ],
  },
  {
    category: 'Info',
    icon: <Hash size={13} />,
    items: [
      { label: '{marketplace}', placeholder: '{marketplace}', hint: 'shopee / mercadolivre' },
      { label: '{marketplace_nome}', placeholder: '{marketplace_nome}', hint: 'Shopee / Mercado Livre' },
      { label: '{source_group}', placeholder: '{source_group}', hint: 'Grupo origem' },
      { label: '{target_group}', placeholder: '{target_group}', hint: 'Grupo destino' },
      { label: '{data}', placeholder: '{data}', hint: '22/07/2026' },
      { label: '{hora}', placeholder: '{hora}', hint: '14:30' },
      { label: '{data_hora}', placeholder: '{data_hora}', hint: '22/07/2026 14:30' },
    ],
  },
  {
    category: 'Condicional',
    icon: <GitBranch size={13} />,
    items: [
      { label: 'se marketplace', placeholder: '{? marketplace = shopee}\n  {texto_original}\n{:}\n  {texto_original}\n{/}', hint: 'Condicional por marketplace' },
      { label: 'se source_group', placeholder: '{? source_group = Nome}\n  {texto_original}\n{/}', hint: 'Condicional por grupo origem' },
    ],
  },
];

// ─── Estilos ─────────────────────────────────────────────────────────

const chipBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  padding: '0.2rem 0.45rem',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--color-border-light)',
  background: 'var(--color-surface)',
  color: 'var(--color-primary)',
  fontSize: 'var(--text-xs)',
  fontFamily: 'var(--font-mono)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: 'all var(--transition-fast)',
  lineHeight: 1.4,
};

const btnStyle: React.CSSProperties = {
  ...chipBase,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-secondary)',
  color: 'var(--color-text-primary)',
};

// ─── Component ───────────────────────────────────────────────────────

export function PlaceholderPicker({ textareaRef, onInsert, currentValue }: PlaceholderPickerProps) {
  function insertAtCursor(placeholder: string) {
    const ta = textareaRef.current;
    if (!ta) return;

    const start = ta.selectionStart;
    const end = ta.selectionEnd;

    const before = currentValue.slice(0, start);
    const after = currentValue.slice(end);

    // Se o placeholder tem quebra de linha (condicional), insere com quebra
    const needsNewlineBefore = placeholder.includes('\n') && before.length > 0 && !before.endsWith('\n');
    const needsNewlineAfter = placeholder.includes('\n') && after.length > 0 && !after.startsWith('\n');

    const insertion = `${needsNewlineBefore ? '\n' : ''}${placeholder}${needsNewlineAfter ? '\n' : ''}`;
    const newValue = before + insertion + after;

    onInsert(newValue);

    // Restaura cursor após o placeholder inserido
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + insertion.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  const sectionTitle: React.CSSProperties = {
    fontSize: 'var(--text-xs)',
    fontWeight: 600,
    color: 'var(--color-text-muted)',
    marginBottom: '0.3rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
  };

  const groupStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.3rem',
    marginBottom: '0.5rem',
  };

  return (
    <div>
      {GROUPS.map((group) => (
        <div key={group.category} style={{ marginBottom: '0.4rem' }}>
          <div style={sectionTitle}>
            {group.icon}
            {group.category}
          </div>
          <div style={groupStyle}>
            {group.items.map((item) => (
              <button
                key={item.placeholder}
                type="button"
                title={item.hint}
                style={item.placeholder.includes('{?') ? btnStyle : chipBase}
                onClick={() => insertAtCursor(item.placeholder)}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-primary-subtle)';
                  (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-primary)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = item.placeholder.includes('{?') ? 'var(--color-bg-secondary)' : 'var(--color-surface)';
                  (e.currentTarget as HTMLButtonElement).style.borderColor = item.placeholder.includes('{?') ? 'var(--color-border)' : 'var(--color-border-light)';
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
