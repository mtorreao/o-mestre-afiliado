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
import { MessageCircle, Gauge } from 'lucide-react';
import { Card, Button, Badge, Loading, Input } from './ui/index.ts';

interface WppConnectionProps {
  token: string;
}

type WppState =
  | { status: 'loading' }
  | { status: 'disconnected' }
  | { status: 'connecting'; message?: string }
  | { status: 'awaiting_scan'; qrcode: string; instanceId?: string }
  | { status: 'connected'; phone: string | null; instanceId?: number; rateLimitMaxMsgs?: number; rateLimitWindowSec?: number }
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
            setState({
              status: 'connected',
              phone: null,
              instanceId: (data as any).instanceId,
              rateLimitMaxMsgs: (data as any).rateLimitMaxMsgs ?? 15,
              rateLimitWindowSec: (data as any).rateLimitWindowSec ?? 300,
            });
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

  // ─── Render body ─────────────────────────────────────────────────────

  /** Wrapper flex column centrado para seções que precisam de layout centralizado */
  const centeredStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1rem',
  };

  function renderBody() {
    switch (state.status) {
      case 'loading':
        return <Loading text="Verificando conexão..." size="sm" />;

      case 'disconnected':
        return (
          <div style={centeredStyle}>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', textAlign: 'center', margin: 0 }}>
              Conecte seu WhatsApp para receber notificações e gerenciar
              os grupos de afiliados diretamente pelo app.
            </p>
            <Button variant="primary" icon={<MessageCircle size={18} />} onClick={handleConnect}>
              Conectar WhatsApp
            </Button>
          </div>
        );

      case 'connecting':
        return <Loading text={state.message || 'Conectando ao WhatsApp...'} />;

      case 'awaiting_scan':
        return (
          <div style={centeredStyle}>
            <div style={{
              background: 'white',
              borderRadius: 'var(--radius-xl)',
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
            <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', textAlign: 'center', margin: 0 }}>
              Escaneie o QR Code com o WhatsApp
            </p>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', textAlign: 'center', margin: 0 }}>
              Abra o WhatsApp no celular → Menu ou Configurações → Dispositivos Conectados → Conectar um dispositivo
            </p>
            <p style={{ color: 'var(--color-warning)', fontSize: 'var(--text-xs)', textAlign: 'center', margin: 0 }}>
              ⏱ Este QR expira em ~60 segundos
            </p>
          </div>
        );

      case 'connected':
        return (
          <div style={centeredStyle}>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: 'var(--color-success-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <MessageCircle size={32} style={{ color: 'var(--color-success)' }} />
            </div>
            <p style={{ color: 'var(--color-success)', fontSize: 'var(--text-base)', fontWeight: 600, margin: 0 }}>
              ✅ WhatsApp Conectado
            </p>
            {state.phone && (
              <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', margin: 0 }}>
                {state.phone}
              </p>
            )}

            {/* Rate limit info */}
            <div style={{
              padding: '0.5rem 0.75rem',
              background: 'var(--color-bg-secondary)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              border: '1px solid var(--color-border-light)',
            }}>
              <Gauge size={16} style={{ color: 'var(--color-primary)' }} />
              <span>
                Limite de envio: <strong>{state.rateLimitMaxMsgs ?? 15}</strong> mensagens a cada{' '}
                <strong>{state.rateLimitWindowSec ?? 300}</strong>s
              </span>
            </div>

            <Button variant="danger" onClick={handleDisconnect}>
              Desconectar WhatsApp
            </Button>
          </div>
        );

      case 'error':
        return (
          <div style={centeredStyle}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'var(--color-error-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.5rem',
            }}>
              ❌
            </div>
            <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', textAlign: 'center', margin: 0 }}>
              {state.message}
            </p>
            <Button variant="outline" onClick={handleRegenerateQR} loading={regeneratingRef.current}>
              🔄 Regenerar QR Code
            </Button>
          </div>
        );
    }
  }

  // ─── Badge de status no header ────────────────────────────────────────

  const badgeVariant: 'success' | 'warning' | 'info' | 'error' | 'neutral' =
    state.status === 'connected' ? 'success'
    : state.status === 'awaiting_scan' ? 'warning'
    : state.status === 'connecting' ? 'info'
    : state.status === 'loading' ? 'info'
    : state.status === 'error' ? 'error'
    : 'neutral';

  const badgeText =
    state.status === 'connected' ? '✅ Conectado'
    : state.status === 'awaiting_scan' ? '⏳ Aguardando scan'
    : state.status === 'connecting' ? '🔄 Conectando'
    : state.status === 'loading' ? '🔄 Verificando'
    : state.status === 'error' ? '❌ Erro'
    : '⚪ Desconectado';

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <Card
      title="💬 WhatsApp"
      action={<Badge variant={badgeVariant}>{badgeText}</Badge>}
    >
      {renderBody()}
    </Card>
  );
}
