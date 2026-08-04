import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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
        <Link className="btn" to="/">
          ← Voltar
        </Link>
      </div>

      {error && <div className="status-line status-error">⚠️ {error}</div>}

      <div className="card">
        <div className="card-title">Log</div>
        {loading && !log ? (
          <div className="muted">Carregando…</div>
        ) : (
          <pre className="log-viewer">{log ?? '(sem log)'}</pre>
        )}
      </div>
    </div>
  );
}
