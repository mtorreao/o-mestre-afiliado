import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Card } from '@omestre/ui';
import { getDeployLog } from '../lib/api.ts';

export default function DeployDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [log, setLog] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      setLog(await getDeployLog(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'falha ao carregar log');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Auto-refresh enquanto o deploy ainda está rodando (log cresce).
    const timer = setInterval(() => {
      void load();
    }, 10000);
    return () => clearInterval(timer);
  }, [id]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Deploy #{id?.slice(0, 8)}</div>
          <div className="page-subtitle">Log completo do deploy</div>
        </div>
        <Button variant="ghost" onClick={() => window.history.back()}>
          ← Voltar
        </Button>
      </div>

      {error && <div className="status-line status-error">⚠️ {error}</div>}

      <Card title="Log">
        {loading && !log ? (
          <div className="muted">Carregando…</div>
        ) : (
          <pre className="log-viewer">{log ?? '(sem log)'}</pre>
        )}
      </Card>
    </div>
  );
}
