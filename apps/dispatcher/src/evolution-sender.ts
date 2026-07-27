/**
 * Envia mensagens via Evolution API (sendMedia com imagem, sendText sem).
 *
 * Retry: 3 tentativas com backoff 2s/4s/8s. Erros de rede e respostas
 * não-ok acionam o retry.
 *
 * Variáveis de ambiente:
 *  - EVOLUTION_API_URL (default: http://localhost:5444)
 *  - EVOLUTION_API_KEY
 */
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:5444';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

function log(level: 'info' | 'warn' | 'error', message: string, data?: unknown) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'dispatcher',
    message,
    ...(data ? { data } : {}),
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

function evolutionHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: EVOLUTION_API_KEY,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Envia via Evolution API (sendMedia com imagem, sendText sem).
 * Retry: 3 tentativas, backoff 2s/4s/8s.
 *
 * Retorna true se o envio foi confirmado (HTTP 2xx), false após
 * esgotar as tentativas.
 */
export async function sendMediaOrText(
  instanceName: string,
  groupJid: string,
  text: string,
  imageUrl: string,
): Promise<boolean> {
  const maxAttempts = 3;
  const delays: number[] = [2_000, 4_000, 8_000];

  const endpoint = imageUrl
    ? `${EVOLUTION_API_URL}/message/sendMedia/${instanceName}`
    : `${EVOLUTION_API_URL}/message/sendText/${instanceName}`;

  const body = imageUrl
    ? {
        number: groupJid,
        media: imageUrl,
        mediatype: 'image' as const,
        caption: text,
        delay: 2000,
      }
    : { number: groupJid, text, delay: 2000, linkPreview: true };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: evolutionHeaders(),
        body: JSON.stringify(body),
      });

      if (res.ok) {
        return true;
      }

      const responseText = await res.text();

      if (attempt === maxAttempts) {
        log('error', 'Falha ao enviar mensagem após todas as tentativas', {
          instanceName,
          groupJid,
          status: res.status,
          body: responseText.slice(0, 500),
          attempts: attempt,
        });
        return false;
      }

      log('warn', 'Falha ao enviar mensagem, tentando novamente', {
        instanceName,
        groupJid,
        status: res.status,
        attempt,
        nextRetryMs: delays[attempt - 1],
      });
    } catch (err) {
      if (attempt === maxAttempts) {
        log('error', 'Erro ao enviar mensagem após todas as tentativas', {
          instanceName,
          groupJid,
          error: err instanceof Error ? err.message : String(err),
          attempts: attempt,
        });
        return false;
      }

      log('warn', 'Erro ao enviar mensagem, tentando novamente', {
        instanceName,
        groupJid,
        error: err instanceof Error ? err.message : String(err),
        attempt,
        nextRetryMs: delays[attempt - 1],
      });
    }

    await sleep(delays[attempt - 1]!);
  }

  return false;
}
