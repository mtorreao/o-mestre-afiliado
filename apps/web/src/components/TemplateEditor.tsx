/**
 * TemplateEditor — Editor completo de template de mensagem.
 *
 * Combina:
 *   - PlaceholderPicker (botões de inserção — sempre visíveis)
 *   - Textarea com placeholder legend
 *   - Validação inline (placeholders desconhecidos via API)
 *   - Caractere count
 *   - Ajuda de condicionais (collapsible)
 */
import { useState, useEffect, useRef } from 'react';
import { AlertTriangle, CheckCircle, Type, HelpCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { PlaceholderPicker } from './PlaceholderPicker.tsx';
import { fetchApi } from '../lib/api-client.ts';

interface TemplateEditorProps {
  value: string;
  onChange: (value: string) => void;
  token: string;
  /** Se true, mostra aviso sobre template padrão (vazio) */
  showDefaultHint?: boolean;
  /** Placeholder do textarea */
  placeholder?: string;
}

interface ValidationResult {
  valid: boolean;
  unknownPlaceholders: string[];
  containsConditional: boolean;
  containsLinkOrText: boolean;
  conditionalErrors: string[];
}

// ─── Estilos compartilhados ──────────────────────────────────────────

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
  minHeight: '120px',
};

const legendStyle: React.CSSProperties = {
  padding: '0.6rem 0.75rem',
  background: 'var(--color-bg-secondary)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-secondary)',
  border: '1px solid var(--color-border-light)',
  lineHeight: 1.6,
};

const statusBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  flexWrap: 'wrap',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-muted)',
};

// ─── Tutorial Rápido ───────────────────────────────────────────────

const tutorialCardStyle: React.CSSProperties = {
  padding: '0.65rem 0.75rem',
  background: 'var(--color-surface)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border-light)',
  cursor: 'pointer',
  transition: 'all var(--transition-fast)',
  fontSize: 'var(--text-xs)',
  lineHeight: 1.6,
  flex: '1 1 180px',
  minWidth: '160px',
};

const tutorialCodeStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-primary)',
  background: 'var(--color-primary-subtle)',
  padding: '0.2rem 0.35rem',
  borderRadius: 'var(--radius-sm)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  display: 'block',
  marginTop: '0.25rem',
  lineHeight: 1.5,
};

const TEMPLATE_PRESETS = [
  {
    title: '📝 Básico',
    desc: 'Envia o texto original com link convertido',
    template: '{texto_original}',
  },
  {
    title: '🏷️ Com metadata',
    desc: 'Inclui marketplace, data e link',
    template: '{marketplace_nome} — {data}\n{link_convertido}',
  },
  {
    title: '🔀 Com condicional',
    desc: 'Mensagem diferente por marketplace',
    template: "{se marketplace for igual a 'shopee'}🛒{senão}📦{fim} {link_convertido}",
  },
  {
    title: '📦 Completo',
    desc: 'Tudo junto: condicional + metadata + origem/destino',
    template: [
      "{se marketplace for igual a 'shopee'}",
      '🛒',
      '{senão se marketplace for igual a mercadolivre}',
      '📦',
      '{senão}',
      '🔗',
      '{fim}',
      ' {link_convertido}',
      '📍 {source_group} → {target_group}',
    ].join('\n'),
  },
];

function TemplateTutorial({ onApply, currentValue }: { onApply: (v: string) => void; currentValue: string }) {
  const isActive = (tmpl: string) => currentValue.trim() === tmpl.trim();

  return (
    <div>
      <div style={{
        fontSize: 'var(--text-xs)',
        fontWeight: 600,
        color: 'var(--color-text-secondary)',
        marginBottom: '0.35rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.3rem',
      }}>
        <HelpCircle size={13} />
        Comece por um modelo (clique para aplicar):
      </div>
      <div style={{
        display: 'flex',
        gap: '0.5rem',
        flexWrap: 'wrap',
      }}>
        {TEMPLATE_PRESETS.map((preset) => (
          <div
            key={preset.title}
            style={{
              ...tutorialCardStyle,
              ...(isActive(preset.template) ? {
                borderColor: 'var(--color-primary)',
                background: 'var(--color-primary-subtle)',
              } : {}),
            }}
            onClick={() => onApply(preset.template)}
            onMouseEnter={(e) => {
              if (!isActive(preset.template)) {
                e.currentTarget.style.borderColor = 'var(--color-primary)';
                e.currentTarget.style.background = 'var(--color-surface-hover)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive(preset.template)) {
                e.currentTarget.style.borderColor = 'var(--color-border-light)';
                e.currentTarget.style.background = 'var(--color-surface)';
              }
            }}
          >
            <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '0.15rem' }}>
              {preset.title}
            </div>
            <div style={{ color: 'var(--color-text-muted)', marginBottom: '0.3rem' }}>
              {preset.desc}
            </div>
            <div style={tutorialCodeStyle}>
              {preset.template}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Ajuda de Condicionais ───────────────────────────────────────────

function ConditionalHelp() {
  const [open, setOpen] = useState(true); // começa expandido

  const toggleBtnStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    background: 'none',
    border: 'none',
    color: 'var(--color-primary)',
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
    cursor: 'pointer',
    padding: '0.15rem 0',
  };

  const helpBoxStyle: React.CSSProperties = {
    padding: '0.75rem',
    background: 'var(--color-bg-secondary)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border-light)',
    fontSize: 'var(--text-xs)',
    lineHeight: 1.7,
    color: 'var(--color-text-secondary)',
  };

  const codeStyle: React.CSSProperties = {
    color: 'var(--color-primary)',
    background: 'var(--color-primary-subtle)',
    padding: '0.1rem 0.3rem',
    borderRadius: 'var(--radius-sm)',
    fontFamily: 'var(--font-mono)',
    wordBreak: 'break-all',
  };

  const exBoxStyle: React.CSSProperties = {
    padding: '0.5rem 0.65rem',
    background: 'var(--color-surface)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-border-light)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-xs)',
    whiteSpace: 'pre-wrap',
    margin: '0.3rem 0',
    lineHeight: 1.5,
  };

  return (
    <div>
      <button
        type="button"
        style={toggleBtnStyle}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <HelpCircle size={13} />
        Como usar condicionais no template
      </button>

      {open && (
        <div style={{ marginTop: '0.4rem' }}>
          <div style={helpBoxStyle}>
            <strong>📌 Sintaxe humanizada (recomendada):</strong>
            <div style={exBoxStyle}>
              {`{se marketplace for igual a 'shopee'}
  🛒 Oferta da Shopee!
{senão}
  📦 Outro marketplace
{fim}`}
            </div>

            <div style={{ marginTop: '0.5rem' }}>
              <strong>📖 Regras:</strong>
              <ul style={{ margin: '0.3rem 0', paddingLeft: '1.2rem' }}>
                <li><code style={codeStyle}>{'{se condição}'}</code> — inicia um bloco condicional</li>
                <li><code style={codeStyle}>{'{senão se condição}'}</code> — else-if (opcional)</li>
                <li><code style={codeStyle}>{'{senão}'}</code> — else (opcional)</li>
                <li><code style={codeStyle}>{'{fim}'}</code> — fecha o bloco condicional</li>
                <li>Ou tudo <strong>inline</strong>: <code style={codeStyle}>{'{se X então A senão B}'}</code></li>
                <li>Condicionais podem ser <strong>aninhadas</strong></li>
                <li>Operadores: <code style={codeStyle}>for igual a</code> e <code style={codeStyle}>for diferente de</code></li>
              </ul>
            </div>

            <div style={{ marginTop: '0.5rem' }}>
              <strong>🎯 Campos disponíveis:</strong>
              <ul style={{ margin: '0.3rem 0', paddingLeft: '1.2rem' }}>
                <li><code style={codeStyle}>marketplace</code> — <code style={codeStyle}>shopee</code>, <code style={codeStyle}>mercadolivre</code>, <code style={codeStyle}>amazon</code></li>
                <li><code style={codeStyle}>source_group</code> — nome do grupo de origem</li>
                <li><code style={codeStyle}>target_group</code> — nome do grupo de destino</li>
              </ul>
            </div>

            <div style={{ marginTop: '0.5rem' }}>
              <strong>💡 Exemplos:</strong>
            </div>

            <div style={exBoxStyle}>
              {`{se marketplace for igual a 'shopee' então 🛒{link_convertido} senão 📦{link_convertido}}`}
            </div>

            <div style={exBoxStyle}>
              {`{se marketplace for igual a 'shopee'}
🛒 {link_convertido}
{senão se marketplace for igual a 'mercadolivre'}
📦 {link_convertido}
{senão}
🔗 {link_convertido}
{fim}
📍 De {source_group} para {target_group}`}
            </div>

            <div style={exBoxStyle}>
              {`{se marketplace for igual a 'shopee'}
{se source_group for igual a 'VIP'}
  🏆 Oferta VIP: {link_convertido}
{fim}
🛒 {link_convertido}
{fim}`}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Component Principal ──────────────────────────────────────────────

export function TemplateEditor({
  value,
  onChange,
  token,
  showDefaultHint = true,
  placeholder = '{texto_original}',
}: TemplateEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  // Debounce da validação: 600ms após parar de digitar
  useEffect(() => {
    if (!value.trim()) {
      setValidation(null);
      return;
    }

    const timer = setTimeout(async () => {
      setValidating(true);
      try {
        const res = await fetchApi<{ success: boolean } & ValidationResult>(
          '/api/affiliate/validate-template',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ template: value }),
          },
        );
        if (res.success && res.data) {
          setValidation({
            valid: res.data.valid,
            unknownPlaceholders: res.data.unknownPlaceholders,
            containsConditional: res.data.containsConditional,
            containsLinkOrText: res.data.containsLinkOrText,
            conditionalErrors: res.data.conditionalErrors,
          });
        }
      } catch {
        // Silencia erros de validação (não crítico)
      }
      setValidating(false);
    }, 600);

    return () => clearTimeout(timer);
  }, [value, token]);

  const charCount = value.length;
  const charLimit = 4000;
  const isNearLimit = charCount > charLimit * 0.85;
  const isOverLimit = charCount > charLimit;

  const isDefault = !value.trim();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {/* Default hint (só quando vazio) */}
      {showDefaultHint && isDefault && (
        <div style={legendStyle}>
          💡 <strong>Template vazio</strong> — será usado o comportamento padrão:
          enviar o texto original com o link convertido.
        </div>
      )}

      {/* Placeholder Picker — SEMPRE visível, mesmo com template vazio */}
      <div>
        <div style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 600,
          color: 'var(--color-text-secondary)',
          marginBottom: '0.35rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.3rem',
        }}>
          <HelpCircle size={13} />
          Clique para inserir um placeholder no cursor:
        </div>
        <PlaceholderPicker
          textareaRef={textareaRef}
          currentValue={value}
          onInsert={onChange}
        />
      </div>

      {/* ─── Tutorial Rápido ──────────────────────────────────────── */}
      <TemplateTutorial onApply={onChange} currentValue={value} />

      {/* Ajuda de condicionais */}
      <ConditionalHelp />

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange((e.target as HTMLTextAreaElement).value)}
        placeholder={placeholder}
        rows={5}
        style={{
          ...textareaStyle,
          ...(validation && !validation.valid ? { borderColor: 'var(--color-warning)' } : {}),
          ...(isOverLimit ? { borderColor: 'var(--color-error)' } : {}),
        }}
      />

      {/* Status bar */}
      <div style={statusBarStyle}>
        {/* Char count */}
        <span style={{ color: isOverLimit ? 'var(--color-error)' : isNearLimit ? 'var(--color-warning)' : undefined }}>
          <Type size={12} style={{ verticalAlign: 'middle', marginRight: '0.2rem' }} />
          {charCount}/{charLimit}
        </span>

        {/* Validation status */}
        {validating && <span style={{ color: 'var(--color-text-muted)' }}>Validando...</span>}

        {validation && !validating && (
          <>
            {validation.valid ? (
              <span style={{ color: 'var(--color-success)' }}>
                <CheckCircle size={12} style={{ verticalAlign: 'middle', marginRight: '0.2rem' }} />
                Válido
              </span>
            ) : (
              <span style={{ color: 'var(--color-warning)' }}>
                <AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: '0.2rem' }} />
                {validation.unknownPlaceholders.length > 0 && (
                  <>Placeholders desconhecidos: {validation.unknownPlaceholders.join(', ')}</>
                )}
                {validation.conditionalErrors.length > 0 && (
                  <>{validation.conditionalErrors[0]}</>
                )}
              </span>
            )}
          </>
        )}

        {validation && !validation.containsLinkOrText && !validating && value.trim() && (
          <span style={{ color: 'var(--color-warning)' }}>
            <AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: '0.2rem' }} />
            Sem {'{texto_original}'} nem {'{link_convertido}'} — mensagem pode ficar vazia
          </span>
        )}
      </div>
    </div>
  );
}
