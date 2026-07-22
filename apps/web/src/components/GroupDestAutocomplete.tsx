/**
 * GroupDestAutocomplete — Multi-select para grupos de destino.
 *
 * Busca grupos do WhatsApp conectado via API e permite selecionar
 * 1 ou mais grupos como destino do espelhamento de ofertas.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useWhatsAppGroups } from '../hooks/useWhatsAppGroups.ts';

interface Group {
  jid: string;
  name: string;
}

interface GroupDestAutocompleteProps {
  token: string;
  value: Group[];
  onChange: (groups: Group[]) => void;
  refreshSignal?: number;
}

export function GroupDestAutocomplete({ token, value, onChange, refreshSignal }: GroupDestAutocompleteProps) {
  const { groups, loading, error, refresh } = useWhatsAppGroups(token);
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Reage a refreshSignal do pai (ex: botão Atualizar no MirrorConfigSection)
  const prevSignal = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal !== undefined && refreshSignal !== prevSignal.current) {
      prevSignal.current = refreshSignal;
      refresh(true);
    }
  }, [refreshSignal, refresh]);

  // Filtra grupos não selecionados
  const selectedJids = new Set(value.map((g) => g.jid));
  const filtered = query.trim()
    ? groups.filter(
        (g) =>
          !selectedJids.has(g.jid) &&
          g.name.toLowerCase().includes(query.toLowerCase()),
      )
    : groups.filter((g) => !selectedJids.has(g.jid));

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
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
      inputRef.current?.focus();
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

  // Estados
  if (loading) {
    return (
      <div style={{ padding: '0.75rem 0', color: '#94a3b8', fontSize: '0.85rem' }}>
        Carregando grupos...
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div style={{ padding: '0.75rem 0', color: '#f87171', fontSize: '0.85rem' }}>
          ❌ {error}
        </div>
        <button
          onClick={() => refresh()}
          style={{
            padding: '0.3rem 0.6rem',
            borderRadius: '4px',
            border: '1px solid #475569',
            background: 'transparent',
            color: '#94a3b8',
            fontSize: '0.8rem',
            cursor: 'pointer',
          }}
        >
          🔄 Tentar novamente
        </button>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div style={{ padding: '0.75rem 0', color: '#94a3b8', fontSize: '0.85rem' }}>
        Nenhum grupo encontrado. Certifique-se de que o WhatsApp está conectado e participa de grupos.
      </div>
    );
  }

  return (
    <div>
      {/* Tags selecionadas */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem' }}>
        {value.map((g) => (
          <span
            key={g.jid}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              padding: '0.25rem 0.5rem',
              borderRadius: '4px',
              background: '#22c55e20',
              border: '1px solid #22c55e40',
              color: '#4ade80',
              fontSize: '0.8rem',
            }}
          >
            📨 {g.name}
            <button
              onClick={() => handleRemove(g.jid)}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
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
          <span style={{ fontSize: '0.75rem', color: '#94a3b8', alignSelf: 'center' }}>
            {value.length} selecionado(s)
          </span>
        )}
      </div>

      {/* Input de busca */}
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
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
          onKeyDown={handleKeyDown}
          placeholder="Buscar grupo de destino..."
          style={{
            width: '100%',
            padding: '0.5rem 0.625rem',
            borderRadius: '6px',
            border: '1px solid #334155',
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
            {filtered.map((g, i) => (
              <div
                key={g.jid}
                onClick={() => handleSelect(g)}
                onMouseEnter={() => setHighlightIndex(i)}
                style={{
                  padding: '0.5rem 0.75rem',
                  cursor: 'pointer',
                  background: highlightIndex === i ? '#334155' : 'transparent',
                  color: highlightIndex === i ? '#e2e8f0' : '#94a3b8',
                  fontSize: '0.85rem',
                  borderBottom: i < filtered.length - 1 ? '1px solid #1e293b' : 'none',
                }}
              >
                {g.name}
              </div>
            ))}
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
