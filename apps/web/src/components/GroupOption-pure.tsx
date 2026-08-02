/**
 * GroupOption-pure — renderização pura (sem React state) do item do dropdown
 * de grupos. Extraída para permitir cobertura 100% via SSR.
 *
 * Usada por GroupOfferAutocomplete e GroupDestAutocomplete.
 */
import { GroupAvatar } from './GroupAvatar.tsx';

export interface GroupOptionData {
  jid: string;
  name: string;
  isAdmin?: boolean;
  pictureUrl?: string | null;
}

export interface RenderGroupOptionInput {
  group: GroupOptionData;
  index: number;
  listboxId: string;
  highlighted: boolean;
  /** Handlers opcionais (mousedown/mouseenter) — aplicados ao option raiz. */
  onMouseDown?: (event: React.MouseEvent) => void;
  onMouseEnter?: () => void;
}

/**
 * Renderiza um item do dropdown de grupos. Mantém compatibilidade
 * 1:1 com o JSX que existia inline nos autocompletes. Exposto como
 * função pura (não componente) para que o `bun test` consiga
 * renderizar via `react-dom/server` sem precisar de DOM.
 */
export function renderGroupOption({
  group,
  index,
  listboxId,
  highlighted,
  onMouseDown,
  onMouseEnter,
}: RenderGroupOptionInput) {
  return (
    <div
      key={group.jid}
      id={`${listboxId}-option-${index}`}
      role="option"
      aria-selected={highlighted}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      style={{
        padding: '0.5rem 0.75rem',
        cursor: 'pointer',
        background: highlighted ? '#334155' : 'transparent',
        color: highlighted ? '#e2e8f0' : '#64748b',
        fontSize: '0.85rem',
        borderBottom: '1px solid #1e293b',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <GroupAvatar name={group.name} pictureUrl={group.pictureUrl ?? null} size={20} />
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {group.name}
        </span>
      </span>
    </div>
  );
}
