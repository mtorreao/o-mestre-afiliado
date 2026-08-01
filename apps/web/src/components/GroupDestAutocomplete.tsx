/**
 * GroupDestAutocomplete — Multi-select para grupos de destino.
 *
 * Busca grupos do WhatsApp conectado via API e permite selecionar
 * 1 ou mais grupos como destino do espelhamento de ofertas.
 */
import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { useWhatsAppGroups } from '../hooks/useWhatsAppGroups.ts';
import { filterWhatsAppGroupsByAdmin } from '../hooks/whatsapp-groups-pure.ts';
import { GroupAvatar } from './GroupAvatar.tsx';
import { renderGroupOption } from './GroupOption-pure.tsx';

interface Group {
  jid: string;
  name: string;
  isAdmin?: boolean;
  pictureUrl?: string | null;
}

interface GroupDestAutocompleteProps {
  token: string;
  value: Group[];
  onChange: (groups: Group[]) => void;
  refreshSignal?: number;
  /** id estavel do input (foco programatico + aria-controls/aria-activedescendant) */
  inputId?: string;
  /** nome acessivel do combobox */
  ariaLabel?: string;
  /** erro do campo (controlado pelo pai) - liga aria-invalid/aria-describedby */
  error?: string | null;
  /** id do elemento do pai que renderiza a mensagem de erro */
  errorId?: string;
  /** Disparado quando o input de busca perde o foco (validacao onBlur do pai). */
  onBlur?: () => void;
  /** Ref exposta para o input de busca (foco no primeiro campo com erro). */
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function GroupDestAutocomplete({
  token,
  value,
  onChange,
  refreshSignal,
  inputId,
  ariaLabel,
  error,
  errorId,
  onBlur,
  inputRef,
}: GroupDestAutocompleteProps) {
  const { groups, loading, error: fetchError, refresh } = useWhatsAppGroups(token);
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const internalRef = useRef<HTMLInputElement>(null);
  const searchRef = inputRef ?? internalRef;
  const dropdownRef = useRef<HTMLDivElement>(null);
  // A11y: ids estaveis para o padrao combobox (aria-controls, aria-activedescendant)
  const uid = useId();
  const searchInputId = inputId ?? `dest-autocomplete-input-${uid}`;
  const listboxId = `${searchInputId}-listbox`;

  // Reage a refreshSignal do pai (ex: botão Atualizar no MirrorConfigSection)
  const prevSignal = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal !== undefined && refreshSignal !== prevSignal.current) {
      prevSignal.current = refreshSignal;
      refresh(true);
    }
  }, [refreshSignal, refresh]);

  // Filtra grupos não selecionados
  const adminGroups = filterWhatsAppGroupsByAdmin(groups, true);
  const selectedJids = new Set(value.map((g) => g.jid));
  const filtered = query.trim()
    ? adminGroups.filter(
        (g) => !selectedJids.has(g.jid) && g.name.toLowerCase().includes(query.toLowerCase()),
      )
    : adminGroups.filter((g) => !selectedJids.has(g.jid));

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        searchRef.current &&
        !searchRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = useCallback(
    (group: Group) => {
      onChange([...value, group]);
      setQuery('');
      setHighlightIndex(-1);
      searchRef.current?.focus();
    },
    [value, onChange],
  );

  const handleRemove = useCallback(
    (jid: string) => {
      onChange(value.filter((g) => g.jid !== jid));
    },
    [value, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === 'ArrowDown' || e.key === 'Enter') {
          setIsOpen(true);
          setHighlightIndex(0);
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightIndex((prev) => Math.min(prev + 1, filtered.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (highlightIndex >= 0 && highlightIndex < filtered.length) {
            handleSelect(filtered[highlightIndex]!);
          }
          break;
        case 'Escape':
          setIsOpen(false);
          setHighlightIndex(-1);
          break;
        case 'Backspace':
          if (!query && value.length > 0) {
            handleRemove(value[value.length - 1]!.jid);
          }
          break;
        case 'Tab':
          setIsOpen(false);
          break;
      }
    },
    [isOpen, filtered, highlightIndex, handleSelect, query, value],
  );

  return (
    <div>
      {/* Status (loading / erro / vazio) — sempre acessível via aria-live */}
      {loading && (
        <div role="status" style={{ padding: '0.5rem 0', color: '#64748b', fontSize: '0.85rem' }}>
          Carregando grupos...
        </div>
      )}
      {!loading && fetchError && (
        <div
          role="alert"
          style={{
            padding: '0.5rem 0',
            color: '#dc2626',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <span>❌ {fetchError}</span>
          <button
            onClick={() => refresh()}
            style={{
              padding: '0.2rem 0.5rem',
              borderRadius: '4px',
              border: '1px solid #475569',
              background: 'transparent',
              color: '#64748b',
              fontSize: '0.8rem',
              cursor: 'pointer',
            }}
          >
            🔄 Tentar novamente
          </button>
        </div>
      )}
      {!loading && !fetchError && groups.length === 0 && (
        <div role="status" style={{ padding: '0.5rem 0', color: '#64748b', fontSize: '0.85rem' }}>
          Nenhum grupo encontrado. Certifique-se de que o WhatsApp está conectado e participa de
          grupos.
        </div>
      )}
      {!loading && !fetchError && groups.length > 0 && adminGroups.length === 0 && (
        <div role="status" style={{ padding: '0.5rem 0', color: '#64748b', fontSize: '0.85rem' }}>
          Nenhum grupo disponível. Você precisa ser administrador do grupo para usá-lo como destino.
        </div>
      )}
      {/* Tags selecionadas */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem' }}>
        {value.map((g) => (
          <span
            key={g.jid}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.25rem 0.5rem',
              borderRadius: '4px',
              background: '#22c55e20',
              border: '1px solid #22c55e40',
              color: '#4ade80',
              fontSize: '0.8rem',
            }}
          >
            <GroupAvatar name={g.name} pictureUrl={g.pictureUrl ?? null} size={16} />
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '180px',
              }}
            >
              {g.name}
            </span>
            <button
              onClick={() => handleRemove(g.jid)}
              style={{
                background: 'none',
                border: 'none',
                color: '#64748b',
                cursor: 'pointer',
                padding: 0,
                fontSize: '0.9rem',
                lineHeight: 1,
              }}
              title="Remover"
            >
              ×
            </button>
          </span>
        ))}
        {value.length > 0 && (
          <span style={{ fontSize: '0.75rem', color: '#64748b', alignSelf: 'center' }}>
            {value.length} selecionado(s)
          </span>
        )}
      </div>

      {/* Input de busca */}
      <div style={{ position: 'relative' }}>
        <input
          ref={searchRef}
          id={searchInputId}
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={
            isOpen && highlightIndex >= 0 && highlightIndex < filtered.length
              ? `${listboxId}-option-${highlightIndex}`
              : undefined
          }
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          aria-label={ariaLabel ?? 'Buscar grupo de destino'}
          value={query}
          onChange={(e) => {
            setQuery((e.target as HTMLInputElement).value);
            setIsOpen(true);
            setHighlightIndex(0);
          }}
          onFocus={() => {
            setIsOpen(true);
            setHighlightIndex(0);
          }}
          onBlur={() => {
            // Não fechar o dropdown aqui: o blur dispara no mousedown do item e fechar
            // antes do click impediria a seleção por mouse (regressão f58e818).
            // handleClickOutside (mousedown fora) + Tab + Escape fecham o dropdown.
            onBlur?.();
          }}
          onKeyDown={handleKeyDown}
          placeholder="Buscar grupo de destino..."
          style={{
            width: '100%',
            padding: '0.5rem 0.625rem',
            borderRadius: '6px',
            border: `1px solid ${error ? 'var(--color-error)' : '#334155'}`,
            background: '#0f172a',
            color: '#e2e8f0',
            fontSize: '0.85rem',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />

        {/* Dropdown */}
        {isOpen && filtered.length > 0 && (
          <div
            ref={dropdownRef}
            role="listbox"
            id={listboxId}
            aria-label={ariaLabel ?? 'Grupos de destino disponiveis'}
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              maxHeight: '200px',
              overflowY: 'auto',
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '6px',
              marginTop: '2px',
              zIndex: 10,
            }}
          >
            {filtered.map((g, i) => {
              const onSelect = () => handleSelect(g);
              return (
                <div
                  key={g.jid}
                  id={`${listboxId}-option-${i}`}
                  role="option"
                  aria-selected={highlightIndex === i}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect();
                  }}
                  onMouseEnter={() => setHighlightIndex(i)}
                  style={{
                    padding: '0.5rem 0.75rem',
                    cursor: 'pointer',
                    background: highlightIndex === i ? '#334155' : 'transparent',
                    color: highlightIndex === i ? '#e2e8f0' : '#64748b',
                    fontSize: '0.85rem',
                    borderBottom: i < filtered.length - 1 ? '1px solid #1e293b' : 'none',
                  }}
                >
                  {renderGroupOption({
                    group: g,
                    index: i,
                    listboxId,
                    highlighted: highlightIndex === i,
                  })}
                </div>
              );
            })}
          </div>
        )}

        {isOpen && query && filtered.length === 0 && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              padding: '0.5rem 0.75rem',
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '6px',
              marginTop: '2px',
              color: '#64748b',
              fontSize: '0.85rem',
              zIndex: 10,
            }}
          >
            Nenhum grupo encontrado
          </div>
        )}
      </div>
    </div>
  );
}
