import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  listDeploys,
  logout,
  testTelegram,
  triggerManualDeploy,
  type DeployRecord,
} from '../lib/api.ts';

const STATUS_BADGE: Record<DeployRecord['status'], string> = {
  running: 'badge-running',
  success: 'badge-success',
  failed: 'badge-failed',
  timeout: 'badge-timeout',
};

const STATUS_LABEL: Record<DeployRecord['status'], string> = {
  running: 'rodando',
  success: 'sucesso',
  failed: 'falhou',
  timeout: 'timeout',
};

interface Props {
  onLogout: () => void;
}

export default function DashboardPage({ onLogout }: Props) {
  const navigate = useNavigate();
  const [deploys, setDeploys] = useState<DeployRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tgStatus, setTgStatus] = useState<string | null>(null);

  const [manualRef, setManualRef] = useState('');
  const [manualSha, setManualSha] = useState('');
  const [manualBusy, setManualBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      setDeploys(await listDeploys());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'falha ao carregar');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  async function handleLogout() {
    await logout();
    onLogout();
  }

  async function handleTestTelegram() {
    setTgStatus(null);
    try {
      const ok = await testTelegram();
      setTgStatus(ok ? '✅ notificação de teste enviada' : '❌ falha ao enviar');
    } catch (err) {
      setTgStatus(`❌ ${err instanceof Error ? err.message : 'erro'}`);
    }
  }

  async function handleManualDeploy(e: React.FormEvent) {
    e.preventDefault();
    if (!manualRef.trim()) return;
    setManualBusy(true);
    try {
      const { deployId } = await triggerManualDeploy(
        manualRef.trim(),
        manualSha.trim() || 'manual',
      );
      setManualRef('');
      setManualSha('');
      navigate(`/deploys/${deployId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'falha ao disparar deploy');
    } finally {
      setManualBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">⚙️ Admin Center</div>
          <div className="page-subtitle">Deploys e operações do O Mestre Afiliado</div>
        </div>
        <div className="row">
          <button
            className="btn"
            onClick={handleTestTelegram}
            title="Envia mensagem de teste no Telegram"
          >
            📨 Testar Telegram
          </button>
          <button className="btn btn-danger" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </div>

      {tgStatus && <div className="status-line">{tgStatus}</div>}
      {error && <div className="status-line status-error">⚠️ {error}</div>}

      {/* Deploy manual */}
      <div className="card mb-12">
        <div className="card-title">Deploy manual</div>
        <form className="row" onSubmit={handleManualDeploy}>
          <input
            className="input"
            style={{ maxWidth: 220 }}
            placeholder="ref (ex: v0.4.2)"
            value={manualRef}
            onChange={(e) => setManualRef(e.target.value)}
          />
          <input
            className="input"
            style={{ maxWidth: 220 }}
            placeholder="sha (opcional)"
            value={manualSha}
            onChange={(e) => setManualSha(e.target.value)}
          />
          <button
            className="btn btn-primary"
            type="submit"
            disabled={manualBusy || !manualRef.trim()}
          >
            {manualBusy ? 'Disparando…' : 'Disparar'}
          </button>
        </form>
      </div>

      {/* Histórico */}
      <div className="card">
        <div className="card-title">
          Histórico de deploys{' '}
          {loading && (
            <span className="muted" style={{ fontSize: 12 }}>
              (atualizando…)
            </span>
          )}
        </div>

        {deploys.length === 0 && !loading ? (
          <div className="muted">Nenhum deploy registrado ainda.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Ref</th>
                <th>SHA</th>
                <th>Origem</th>
                <th>Status</th>
                <th>Duração</th>
                <th>Início</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {deploys.map((d) => (
                <tr key={d.id}>
                  <td className="mono">{d.ref}</td>
                  <td className="mono muted">{d.sha.slice(0, 7)}</td>
                  <td>{d.triggeredBy === 'github' ? '🤖 GitHub' : '🖐️ Manual'}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[d.status]}`}>
                      {STATUS_LABEL[d.status]}
                    </span>
                  </td>
                  <td className="muted">
                    {d.durationMs ? `${(d.durationMs / 1000).toFixed(1)}s` : '—'}
                  </td>
                  <td className="muted">{new Date(d.startedAt).toLocaleString('pt-BR')}</td>
                  <td>
                    <Link className="btn" to={`/deploys/${d.id}`} style={{ padding: '4px 10px' }}>
                      Log
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
