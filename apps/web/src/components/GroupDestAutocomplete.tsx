/**
 * GroupDestAutocomplete — Single-select para grupo de destino.
 *
 * Busca grupos do WhatsApp conectado via API e permite selecionar
 * exatamente 1 grupo como destino do espelhamento de ofertas.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useWhatsAppGroups } from '../hooks/useWhatsAppGroups.ts';

interface Group {
  jid: string;
  name: string;
}

interface GroupDestAutocompleteProps {
  token: string;
  value: Group | null;
  onChange: (group: Group | null) => void;
}

export function GroupDestAutocomplete({ token, value, onChange }: GroupDestAutocompleteProps) {
  const { groups, loading, error, refresh } = useWhatsAppGroups(token);
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Filtra grupos (exclui o já selecionado)
  const filtered = query.trim()
    ? groups.filter(
        (g) =>
          g.jid !== value?.jid &&
          g.name.toLowerCase().includes(query.toLowerCase()),
      )
    : groups.filter((g) => g.jid !== value?.jid);

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
      onChange(group);
      setQuery(group.name);
      setIsOpen(false);
      setHighlightIndex(-1);
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    onChange(null);
    setQuery('');
    inputRef.current?.focus();
  }, [onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === 'ArrowDown' || e.key === 'Enter') {
          setIsOpen(true);
          setHighlightIndex(0);
        } else if (e.key === 'Backspace' && !query && value) {
          handleClear();
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
      }
    },
    [isOpen, filtered, highlightIndex, handleSelect, handleClear, query, value],
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
          onClick={refresh}
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
      {/* Grupo selecionado ou input de busca */}
      <div style={{ position: 'relative' }}>
        {value ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 0.625rem',
              borderRadius: '6px',
              border: '1px solid #22c55e40',
              background: '#22c55e10',
              color: '#e2e8f0',
              fontSize: '0.85rem',
            }}
          >
            <span style={{ flex: 1, color: '#4ade80' }}>📨 {value.name}</span>
            <button
              onClick={handleClear}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: '0.2rem',
                fontSize: '0.9rem',
                lineHeight: 1,
              }}
              title="Remover seleção"
            >
              ×
            </button>
          </div>
        ) : (
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
        )}

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
