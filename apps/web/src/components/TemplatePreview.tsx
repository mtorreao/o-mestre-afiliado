/**
 * TemplatePreview — Preview do template com conversão real.
 *
 * Fluxo:
 *   1. Usuário cola URL real de produto
 *   2. Clica "Testar template"
 *   3. Chama /api/affiliate/test-conversion para obter link convertido
 *   4. Chama /api/affiliate/preview-template para renderizar o template
 *   5. Exibe preview + metadata (length, placeholders desconhecidos)
 */
import { useState } from 'react';
import { Card, Button, Input } from './ui/index.ts';
import { Play, AlertTriangle, CheckCircle, ExternalLink } from 'lucide-react';
import { fetchApi } from '../lib/api-client.ts';

interface TemplatePreviewProps {
  token: string;
  template: string;
  /** Placeholders para source/target group (pode vir do mirror) */
  sourceGroupName?: string;
  targetGroupName?: string;
}

interface PreviewResult {
  preview: string;
  unknownPlaceholders: string[];
  isEmpty: boolean;
  length: number;
}

const cardStyle: React.CSSProperties = {
  marginTop: '1rem',
  borderLeft: '4px solid var(--color-primary)',
};

export function TemplatePreview({ token, template, sourceGroupName, targetGroupName }: TemplatePreviewProps) {
  const [testUrl, setTestUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);

  async function handleTest() {
    if (!testUrl.trim()) {
      setError('Cole uma URL de produto para testar');
      return;
    }
    if (!template.trim()) {
      setError('O template está vazio — preencha o template primeiro');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // 1. Chama test-conversion para obter o link convertido e marketplace
      const convRes = await fetchApi<{
        success: boolean;
        affiliateUrl?: string | null;
        marketplace?: string;
        error?: string;
        originalUrl?: string;
      }>('/api/affiliate/test-conversion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: testUrl.trim() }),
      });

      if (!convRes.success) {
        setError(convRes.error || 'Falha ao converter URL de teste');
        setLoading(false);
        return;
      }

      const { affiliateUrl, marketplace } = convRes.data!;

      // 2. Chama preview-template para renderizar
      const previewRes = await fetchApi<{ success: boolean } & PreviewResult>(
        '/api/affiliate/preview-template',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            template,
            testUrl: testUrl.trim(),
            convertedUrl: affiliateUrl ?? null,
            marketplace: marketplace || 'unknown',
            sourceGroupName: sourceGroupName || 'Grupo de Origem',
            targetGroupName: targetGroupName || 'Grupo de Destino',
          }),
        },
      );

      if (!previewRes.success || !previewRes.data) {
        setError(previewRes.error || 'Falha ao renderizar preview');
        setLoading(false);
        return;
      }

      setResult({
        preview: previewRes.data.preview,
        unknownPlaceholders: previewRes.data.unknownPlaceholders,
        isEmpty: previewRes.data.isEmpty,
        length: previewRes.data.length,
      });
    } catch {
      setError('Erro de conexão ao testar template');
    }

    setLoading(false);
  }

  const previewContainerStyle: React.CSSProperties = {
    padding: '0.75rem',
    background: 'var(--color-bg-secondary)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border-light)',
    fontSize: 'var(--text-sm)',
    lineHeight: 1.6,
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
  };

  return (
    <div style={{ marginTop: '1rem' }}>
      <Card
        title="🧪 Testar Template"
        subtitle="Cole uma URL real de produto para ver como o template será enviado"
      >
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 300px' }}>
            <Input
              label="URL de teste"
              placeholder="https://shopee.com.br/produto-123"
              value={testUrl}
              onChange={(e) => {
                setTestUrl((e.target as HTMLInputElement).value);
                setError(null);
                setResult(null);
              }}
            />
          </div>
          <Button
            onClick={handleTest}
            loading={loading}
            disabled={!testUrl.trim() || !template.trim()}
            icon={<Play size={15} />}
            size="sm"
            style={{ marginBottom: '0.3rem' }}
          >
            Testar
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              marginTop: '0.75rem',
              padding: '0.5rem 0.75rem',
              background: 'var(--color-error-subtle)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-error-light)',
              color: 'var(--color-error)',
              fontSize: 'var(--text-xs)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        {/* Result */}
        {result && (
          <div style={{ marginTop: '1rem' }}>
            {/* Metadata */}
            <div
              style={{
                display: 'flex',
                gap: '1rem',
                marginBottom: '0.75rem',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
                flexWrap: 'wrap',
              }}
            >
              <span>
                <ExternalLink size={12} style={{ verticalAlign: 'middle', marginRight: '0.2rem' }} />
                {result.length} caracteres
              </span>
              {result.isEmpty && (
                <span style={{ color: 'var(--color-error)' }}>
                  ⚠️ Template resultou em mensagem vazia!
                </span>
              )}
              {result.unknownPlaceholders.length > 0 && (
                <span style={{ color: 'var(--color-warning)' }}>
                  <AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: '0.2rem' }} />
                  Placeholders desconhecidos: {result.unknownPlaceholders.join(', ')}
                </span>
              )}
              {result.unknownPlaceholders.length === 0 && !result.isEmpty && (
                <span style={{ color: 'var(--color-success)' }}>
                  <CheckCircle size={12} style={{ verticalAlign: 'middle', marginRight: '0.2rem' }} />
                  Template OK
                </span>
              )}
            </div>

            {/* Preview */}
            <div style={previewContainerStyle}>
              {result.preview}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
