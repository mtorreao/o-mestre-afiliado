/**
 * TestConversionSection — Teste de conversão de URL
 */
import { useState } from 'react';
import { Card, Button, Input } from '../../components/ui/index.ts';
import { FlaskConical, Copy, Check } from 'lucide-react';

interface TestConversionSectionProps {
  token: string;
}

export function TestConversionSection({ token }: TestConversionSectionProps) {
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleTest() {
    setTesting(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch('/api/affiliate/test-conversion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url }),
      });
      const data = await res.json() as { success: boolean; affiliateUrl?: string; error?: string };
      if (data.success && data.affiliateUrl) {
        setResult(data.affiliateUrl);
      } else {
        setError(data.error || 'Falha na conversão');
      }
    } catch {
      setError('Erro de conexão');
    }
    setTesting(false);
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card title="🧪 Testar Conversão" subtitle="Teste a conversão de links de produtos">
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Input
            type="url"
            value={url}
            onChange={(e) => setUrl((e.target as HTMLInputElement).value)}
            placeholder="Cole a URL do produto (Shopee ou ML)..."
          />
        </div>
        <Button onClick={handleTest} loading={testing} disabled={!url} icon={<FlaskConical size={16} />}>
          Testar
        </Button>
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

      {result && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.75rem 1rem',
            background: 'var(--color-primary-subtle)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-primary)',
          }}
        >
          <code
            style={{
              flex: 1,
              fontSize: 'var(--text-sm)',
              wordBreak: 'break-all',
              color: 'var(--color-primary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {result}
          </code>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => copyToClipboard(result)}
            icon={copied ? <Check size={14} /> : <Copy size={14} />}
          >
            {copied ? 'Copiado' : 'Copiar'}
          </Button>
        </div>
      )}
    </Card>
  );
}
