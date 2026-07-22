/**
 * WhatsApp Connection — Componente de Conexão WhatsApp via Evolution API
 *
 * Fluxo:
 *   1. Verifica se há instance ativa (GET /api/whatsapp/instance)
 *   2. Se não: mostra botão "Conectar WhatsApp"
 *   3. Ao clicar: POST /api/whatsapp/connect → QR code
 *   4. Polling a cada 5s: GET /api/whatsapp/connection-status
 *   5. Quando connected: mostra sucesso com telefone
 *   6. Botão "Desconectar"
 */

import { useState, useEffect, useCallback, useRef } from 'react';

interface WppConnectionProps {
  token: string;
}

type WppState =
  | { status: 'loading' }
  | { status: 'disconnected' }
  | { status: 'connecting'; message?: string }
  | { status: 'awaiting_scan'; qrcode: string }
  | { status: 'connected'; phone: string | null }
  | { status: 'error'; message: string };

const POLL_INTERVAL = 5000; // 5 segundos

export function WppConnection({ token }: WppConnectionProps) {
  const [state, setState] = useState<WppState>({ status: 'loading' });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectingRef = useRef(false);
  const regeneratingRef = useRef(false);

  // ─── Buscar status inicial ─────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as {
        success: boolean;
        status?: string;
        connected?: boolean;
      };

      if (!data.success) {
        setState({ status: 'disconnected' });
        return null;
      }

      return data;
    } catch {
      return null;
    }
  }, [token]);

  // ─── Iniciar polling de status ──────────────────────────────────────
  const startPolling = useCallback(() => {
    if (pollRef.current) return;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/whatsapp/status', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json() as {
          success: boolean;
          status: string;
          connected: boolean;
        };

        if (data.success) {
          if (data.connected) {
            // Conectou!
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            setState({ status: 'connected', phone: null });
          } else if (data.status === 'disconnected' || data.status === 'close') {
            // QR expirou — tentar auto-recovery 1x
            if (regeneratingRef.current) return;

            regeneratingRef.current = true;
            setState({ status: 'connecting', message: 'QR expirou — regenerando...' });

            try {
              const regRes = await fetch('/api/whatsapp/regenerate-qr', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
              });
              const regData = await regRes.json() as {
                success: boolean;
                qrcode?: string;
                error?: string;
              };

              if (regData.success && regData.qrcode) {
                // Auto-recovery bem-sucedido → novo QR, polling continua
                setState({ status: 'awaiting_scan', qrcode: regData.qrcode });
              } else {
                // Auto-recovery falhou → parar polling e mostrar erro
                if (pollRef.current) {
                  clearInterval(pollRef.current);
                  pollRef.current = null;
                }
                setState({ status: 'error', message: regData.error || 'QR Code expirou. Clique em Regenerar QR Code.' });
              }
            } catch {
              if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
              }
              setState({ status: 'error', message: 'QR Code expirou. Clique em Regenerar QR Code.' });
            } finally {
              regeneratingRef.current = false;
            }
          }
          // Se ainda 'connecting', continua polling
        }
      } catch {
        // Erro de rede, continua polling
      }
    }, POLL_INTERVAL);
  }, [token]);

  // ─── Inicialização ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    fetchStatus().then((data) => {
      if (cancelled) return;

      if (data?.connected) {
        setState({ status: 'connected', phone: null });
      } else if (data?.status === 'connecting') {
        // Já tem instance em modo QR — tenta obter QR novamente
        handleConnect();
      } else {
        setState({ status: 'disconnected' });
      }
    });

    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  // ─── Conectar ────────────────────────────────────────────────────────
  async function handleConnect() {
    if (connectingRef.current) return;
    connectingRef.current = true;

    setState({ status: 'connecting' });

    try {
      const res = await fetch('/api/whatsapp/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json() as {
        success: boolean;
        qrcode?: string;
        error?: string;
      };

      if (!data.success) {
        setState({ status: 'error', message: data.error || 'Falha ao conectar' });
        return;
      }

      if (data.qrcode) {
        setState({ status: 'awaiting_scan', qrcode: data.qrcode });
        // Inicia polling
        startPolling();
      } else {
        setState({ status: 'error', message: 'QR Code não retornado pela Evolution API' });
      }
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Erro de conexão' });
    } finally {
      connectingRef.current = false;
    }
  }

  // ─── Desconectar ────────────────────────────────────────────────────
  async function handleDisconnect() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    setState({ status: 'connecting' });

    try {
      const res = await fetch('/api/whatsapp/disconnect', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json() as { success: boolean };

      if (data.success) {
        setState({ status: 'disconnected' });
      } else {
        setState({ status: 'error', message: 'Falha ao desconectar' });
      }
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Erro de conexão' });
    }
  }

  // ─── Regenerar QR Code ──────────────────────────────────────────
  async function handleRegenerateQR() {
    if (regeneratingRef.current) return;
    regeneratingRef.current = true;

    setState({ status: 'connecting' });

    try {
      const res = await fetch('/api/whatsapp/regenerate-qr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json() as {
        success: boolean;
        qrcode?: string;
        error?: string;
      };

      if (!data.success) {
        setState({ status: 'error', message: data.error || 'Falha ao regenerar QR Code' });
        return;
      }

      if (data.qrcode) {
        setState({ status: 'awaiting_scan', qrcode: data.qrcode });
        // Inicia polling
        startPolling();
      } else {
        setState({ status: 'error', message: 'QR Code não retornado pela Evolution API' });
      }
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Erro de conexão' });
    } finally {
      regeneratingRef.current = false;
    }
  }

  // ─── Estilos compartilhados ─────────────────────────────────────────
  const cardStyle: React.CSSProperties = {
    background: '#1e293b',
    borderRadius: '12px',
    border: '1px solid #334155',
    overflow: 'hidden',
  };

  const headerStyle: React.CSSProperties = {
    padding: '1rem 1.25rem',
    borderBottom: '1px solid #334155',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const bodyStyle: React.CSSProperties = {
    padding: '1.5rem 1.25rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1rem',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '0.6rem 1.25rem',
    borderRadius: '8px',
    border: 'none',
    fontSize: '0.9rem',
    fontWeight: 600,
    cursor: 'pointer',
  };

  const greenButton: React.CSSProperties = {
    ...buttonStyle,
    background: '#22c55e',
    color: 'white',
  };

  const redButton: React.CSSProperties = {
    ...buttonStyle,
    background: '#ef4444',
    color: 'white',
  };

  const orangeButton: React.CSSProperties = {
    ...buttonStyle,
    background: '#f59e0b',
    color: 'white',
  };

  const disabledButton: React.CSSProperties = {
    ...buttonStyle,
    background: '#22c55e40',
    color: '#94a3b8',
    cursor: 'not-allowed',
  };

  // ─── Render ──────────────────────────────────────────────────────────
  function renderBody() {
    switch (state.status) {
      case 'loading':
        return (
          <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
            Verificando conexão...
          </div>
        );

      case 'disconnected':
        return (
          <>
            <div style={{ color: '#94a3b8', fontSize: '0.9rem', textAlign: 'center' }}>
              Conecte seu WhatsApp para receber notificações e gerenciar
              os grupos de afiliados diretamente pelo app.
            </div>
            <button
              onClick={handleConnect}
              style={{
                ...greenButton,
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Conectar WhatsApp
            </button>
          </>
        );

      case 'connecting':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: '40px',
              height: '40px',
              border: '3px solid #334155',
              borderTop: '3px solid #22c55e',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
              {state.message || 'Conectando ao WhatsApp...'}
            </span>
          </div>
        );

      case 'awaiting_scan':
        return (
          <>
            <div style={{
              background: 'white',
              borderRadius: '12px',
              padding: '1rem',
              display: 'flex',
              justifyContent: 'center',
            }}>
              <img
                src={state.qrcode.startsWith('data:') ? state.qrcode : `data:image/png;base64,${state.qrcode}`}
                alt="QR Code WhatsApp"
                style={{ width: '220px', height: '220px', imageRendering: 'pixelated' }}
              />
            </div>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', textAlign: 'center' }}>
              Escaneie o QR Code com o WhatsApp
            </div>
            <div style={{ color: '#64748b', fontSize: '0.8rem', textAlign: 'center' }}>
              Abra o WhatsApp no celular → Menu ou Configurações →
              Dispositivos Conectados → Conectar um dispositivo
            </div>
            <div style={{ color: '#fbbf24', fontSize: '0.8rem', textAlign: 'center' }}>
              ⏱ Este QR expira em ~60 segundos
            </div>
          </>
        );

      case 'connected':
        return (
          <>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: '#22c55e20',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="#22c55e">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
            </div>
            <div style={{ color: '#4ade80', fontSize: '1.1rem', fontWeight: 600 }}>
              ✅ WhatsApp Conectado
            </div>
            {state.phone && (
              <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                {state.phone}
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              <button
                onClick={handleRegenerateQR}
                disabled={regeneratingRef.current}
                style={regeneratingRef.current ? { ...orangeButton, opacity: 0.6, cursor: 'not-allowed' } : orangeButton}
              >
                {regeneratingRef.current ? 'Regenerando...' : '🔄 Regenerar QR Code'}
              </button>
              <button
                onClick={handleDisconnect}
                style={redButton}
              >
                Desconectar WhatsApp
              </button>
            </div>
          </>
        );

      case 'error':
        return (
          <>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: '#ef444420',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.5rem',
            }}>
              ❌
            </div>
            <div style={{ color: '#f87171', fontSize: '0.9rem', textAlign: 'center' }}>
              {state.message}
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              <button
                onClick={handleRegenerateQR}
                disabled={regeneratingRef.current}
                style={regeneratingRef.current ? { ...orangeButton, opacity: 0.6, cursor: 'not-allowed' } : orangeButton}
              >
                {regeneratingRef.current ? 'Regenerando...' : '🔄 Regenerar QR Code'}
              </button>
            </div>
          </>
        );
    }
  }

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>
          💬 WhatsApp
        </span>
        <span style={{
          fontSize: '0.8rem',
          color:
            state.status === 'connected' ? '#4ade80'
            : state.status === 'awaiting_scan' ? '#fbbf24'
            : state.status === 'error' ? '#f87171'
            : '#64748b',
        }}>
          {state.status === 'connected' ? '✅ Conectado'
            : state.status === 'awaiting_scan' ? '⏳ Aguardando scan'
            : state.status === 'connecting' ? '🔄 Conectando'
            : state.status === 'error' ? '❌ Erro'
            : '⚪ Desconectado'}
        </span>
      </div>
      <div style={bodyStyle}>
        {renderBody()}
      </div>
    </div>
  );
}
