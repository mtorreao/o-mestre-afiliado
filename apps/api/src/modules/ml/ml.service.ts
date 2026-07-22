/**
 * ML Service — env vars, repositório e helpers compartilhados
 * para as rotas de Mercado Livre.
 */
import { MlAffiliateRepository } from '@omestre/db';

// ─── Env vars ──────────────────────────────────────────────────────────

export const ML_CLIENT_ID = process.env.ML_CLIENT_ID || '';
export const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET || '';
export const REDIRECT_URI =
  process.env.ML_REDIRECT_URI || 'http://localhost:5442/api/ml/callback';
export const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5441';

// ─── Repository ────────────────────────────────────────────────────────

export const mlRepo = new MlAffiliateRepository();

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * Valida cookies de sessão ML acessando o Link Builder.
 * Retorna { valid, melitat, error }.
 */
export async function validateCookies(
  sessionCookies: string,
  currentMelitat: string | null,
  mlUserId: string,
): Promise<{
  success: boolean;
  valid: boolean;
  message?: string;
  error?: string;
  melitat: string | null;
  nickname?: string;
}> {
  try {
    const res = await fetch(
      'https://www.mercadolivre.com.br/afiliados/linkbuilder',
      {
        headers: {
          Cookie: sessionCookies,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        redirect: 'manual',
      },
    );

    const redirected = res.status === 301 || res.status === 302;
    const loginPage = res.headers.get('location')?.includes('login');

    if (redirected && loginPage) {
      return {
        success: false,
        valid: false,
        error: 'Cookies expirados — faça login novamente no ML e reimporte',
        melitat: null,
      };
    }

    if (!res.ok && res.status !== 200) {
      return {
        success: false,
        valid: false,
        error: `Link Builder retornou HTTP ${res.status}`,
        melitat: null,
      };
    }

    // Extrair tag_in_use do HTML
    const html = await res.text();
    const tagMatch = html.match(/tag_in_use["']:\s*["']([^"']+)/i);
    let detectedMelitat: string | null = null;

    if (tagMatch?.[1]) {
      detectedMelitat = tagMatch[1];

      // Se o melitat atual está vazio ou diferente, salva automaticamente
      if (!currentMelitat || currentMelitat !== detectedMelitat) {
        await mlRepo.patch(mlUserId, { melitat: detectedMelitat });
      }
    }

    return {
      success: true,
      valid: true,
      message: 'Cookies válidos! Link curto disponível.',
      melitat: detectedMelitat,
    };
  } catch (err) {
    return {
      success: false,
      valid: false,
      error: err instanceof Error ? err.message : 'Erro ao validar cookies',
      melitat: null,
    };
  }
}
