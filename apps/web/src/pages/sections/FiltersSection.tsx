/**
 * FiltersSection — Configuração de filtros de conteúdo (blacklist, keywords, dedup)
 *
 * Controla o comportamento do pipeline de espelhamento:
 * - blacklist: termos que BLOQUEIAM a mensagem (qualquer match = ignorada)
 * - keywords: se preenchida, a mensagem SÓ é processada se contiver ao menos uma
 * - dedupHours: janela de tempo para evitar duplicatas
 */
import { useState } from 'react';
import { Card, Button, Input } from '../../components/ui/index.ts';
import { Filter, Save } from 'lucide-react';

interface FiltersData {
  blacklist: string[];
  keywords: string[];
  dedupHours: number;
}

interface FiltersSectionProps {
  token: string;
  initialFilters: FiltersData;
  onUpdate: () => void;
}

export function FiltersSection({ token, initialFilters, onUpdate }: FiltersSectionProps) {
  const [blacklist, setBlacklist] = useState(initialFilters.blacklist.join('\n'));
  const [keywords, setKeywords] = useState(initialFilters.keywords.join('\n'));
  const [dedupHours, setDedupHours] = useState(String(initialFilters.dedupHours));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const filterData: FiltersData = {
        blacklist: blacklist
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
        keywords: keywords
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
        dedupHours: Math.max(1, parseInt(dedupHours, 10) || 24),
      };

      const res = await fetch('/api/affiliate/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ filters: filterData }),
      });
      const data = await res.json() as { success: boolean; message?: string; error?: string };
      if (data.success) {
        setSaved(true);
        onUpdate();
        setTimeout(() => setSaved(false), 4000);
      } else {
        setError(data.error || 'Erro ao salvar filtros');
      }
    } catch {
      setError('Erro de conexão');
    }
    setSaving(false);
  }

  const textareaStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.625rem 0.75rem',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
    fontSize: 'var(--text-sm)',
    fontFamily: 'var(--font-mono)',
    outline: 'none',
    resize: 'vertical',
    lineHeight: 1.5,
    boxSizing: 'border-box',
  };

  const hintStyle: React.CSSProperties = {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-muted)',
    lineHeight: 1.5,
    margin: 0,
  };

  const badgeStyle = (active: boolean): React.CSSProperties => ({
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
    color: active ? 'var(--color-success)' : 'var(--color-text-muted)',
  });

  const hasBlacklist = initialFilters.blacklist.length > 0;
  const hasKeywords = initialFilters.keywords.length > 0;

  return (
    <Card
      title="🔍 Filtros de Conteúdo"
      subtitle="Controle quais mensagens são espelhadas"
      action={
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-text-muted)' }}>
          {hasBlacklist || hasKeywords || initialFilters.dedupHours !== 24 ? '⚙️ Configurado' : '📋 Padrão'}
        </span>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Info box */}
        <div
          style={{
            padding: '0.75rem',
            background: 'var(--color-bg-secondary)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border-light)',
            lineHeight: 1.6,
          }}
        >
          <strong>📖 Como funciona:</strong>
          <br />
          <strong>Blacklist</strong> — termos que bloqueiam a mensagem. Se qualquer termo aparecer no texto, a mensagem é ignorada.
          <br />
          <strong>Keywords</strong> — se preenchida, a mensagem só é espelhada se contiver{' '}
          <em>pelo menos uma</em> das palavras-chave. Vazia = aceita todas.
          <br />
          <strong>Deduplicacão</strong> — janela em horas para evitar reenviar o mesmo link.
        </div>

        {/* Blacklist */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
            <label style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
              🚫 Blacklist
            </label>
            <span style={badgeStyle(hasBlacklist)}>
              {hasBlacklist ? `${initialFilters.blacklist.length} termo(s)` : 'Vazio'}
            </span>
          </div>
          <textarea
            value={blacklist}
            onChange={(e) => setBlacklist((e.target as HTMLTextAreaElement).value)}
            placeholder="Um termo por linha. Ex:&#10;promoção&#10;cupom&#10;desconto"
            rows={4}
            style={textareaStyle}
          />
          <p style={hintStyle}>
            Mensagens contendo qualquer termo acima serão ignoradas.
          </p>
        </div>

        {/* Keywords */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
            <label style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
              🔑 Keywords (opcional)
            </label>
            <span style={badgeStyle(hasKeywords)}>
              {hasKeywords ? `${initialFilters.keywords.length} termo(s)` : 'Vazio (aceita todas)'}
            </span>
          </div>
          <textarea
            value={keywords}
            onChange={(e) => setKeywords((e.target as HTMLTextAreaElement).value)}
            placeholder="Um termo por linha. Ex:&#10;frete grátis&#10;oferta&#10;black friday"
            rows={4}
            style={textareaStyle}
          />
          <p style={hintStyle}>
            Se preenchida, apenas mensagens com <em>pelo menos uma</em> keyword serão espelhadas.
          </p>
        </div>

        {/* Dedup Hours */}
        <div>
          <Input
            label="⏱️ Janela de Deduplicação (horas)"
            type="number"
            min={1}
            max={168}
            value={dedupHours}
            onChange={(e) => setDedupHours((e.target as HTMLInputElement).value)}
            hint="Intervalo em horas para evitar reenvio do mesmo link. Padrão: 24h"
          />
        </div>

        {error && (
          <div
            style={{
              padding: '0.75rem 1rem',
              background: 'var(--color-error-subtle)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-error-light)',
              color: 'var(--color-error)',
              fontSize: 'var(--text-sm)',
            }}
          >
            ❌ {error}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Button onClick={handleSave} loading={saving} icon={<Save size={16} />} size="sm">
            Salvar Filtros
          </Button>
          {saved && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)', fontWeight: 500 }}>
              ✅ Salvo!
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
