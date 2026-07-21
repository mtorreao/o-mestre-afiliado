#!/usr/bin/env bun
/**
 * CLI para conversão de links Mercado Livre
 *
 * Uso: bun run packages/converters/src/cli-mercadolivre.ts <url>
 */

import {
  getCredentials,
  getAccessToken,
  generateViaApi,
  generateViaCookies,
  refreshSessionCookies,
  isMercadoLivreUrl,
} from './mercadolivre.ts';

const MELI_LA_REGEX = /meli\.la\/([A-Za-z0-9]+)/;

function printHelp() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║        Mercado Livre Affiliate Link Converter v2          ║
╚════════════════════════════════════════════════════════════╝

USO:
  bun run mercadolivre <url_do_produto>

CAMINHOS DE INTEGRAÇÃO (em ordem de prioridade):

  1) API OFICIAL (OAuth 2.0) — alto volume
     .env: ML_CLIENT_ID + ML_CLIENT_SECRET + ML_REFRESH_TOKEN
     Endpoint: POST https://api.mercadolivre.com/affiliates/link-builder

  2) COOKIES (simulação do Link Builder) — médio volume
     .env: ML_COOKIES="session_id=xxx; ..."
     Acessa: https://www.mercadolivre.com.br/afiliados/link-builder

EXEMPLOS:
  bun run mercadolivre "https://www.mercadolivre.com.br/produto-X/p/MLB123"
  bun run mercadolivre "https://meli.la/2LguX52"
`);
}

async function main() {
  const input = process.argv[2];

  if (!input || input === '--help' || input === '-h') {
    printHelp();
    process.exit(input ? 0 : 1);
  }

  if (!isMercadoLivreUrl(input)) {
    console.error('❌ URL não parece ser do Mercado Livre.');
    console.error('   Aceito: mercadolivre.com.br/* ou meli.la/*');
    process.exit(1);
  }

  const creds = getCredentials();

  console.log('');
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   Mercado Livre Affiliate Link Converter v2     ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log('');

  let targetUrl = input;
  if (MELI_LA_REGEX.test(input)) {
    console.log(`🔗 Detectado link curto meli.la, resolvendo...`);
    const res = await fetch(input, { method: 'HEAD', redirect: 'manual' });
    const location = res.headers.get('location');
    if (location && location !== input) {
      console.log(`   → Redireciona para: ${location}`);
      targetUrl = location;
    }
    console.log('');
  }

  console.log(`📌 Original: ${input}`);
  console.log('');

  let affiliateLink: string | null = null;
  let method = '';

  // Estratégia 1: API OAuth
  if (creds.clientId && creds.clientSecret) {
    method = '🌐 API Oficial (OAuth 2.0)';
    console.log(`${method}`);
    try {
      const auth = await getAccessToken(
        creds.clientId,
        creds.clientSecret,
        undefined,
        undefined,
        creds.refreshToken,
      );
      console.log(`   ✅ Access token obtido (expira em ${auth.expires_in}s)`);
      affiliateLink = await generateViaApi(targetUrl, auth.access_token);
      console.log(`   ✅ Link gerado via API!`);
    } catch (error) {
      console.error(`   ❌ Erro na API:`, error instanceof Error ? error.message : error);
      console.log(`   ⏩ Tentando próximo método...`);
    }
    console.log('');
  }

  // Estratégia 2: Cookies
  if (!affiliateLink && creds.cookies) {
    method = '🍪 Cookies (Link Builder simulado)';
    console.log(`${method}`);

    try {
      affiliateLink = await generateViaCookies(targetUrl, creds.cookies);

      if (!affiliateLink) {
        console.log(`   ⏳ Tentando renovar cookies...`);
        const newCookies = await refreshSessionCookies(creds.cookies);
        affiliateLink = await generateViaCookies(targetUrl, newCookies);
      }

      if (affiliateLink) {
        console.log(`   ✅ Link gerado via cookies!`);
      } else {
        console.log(`   ❌ Não foi possível gerar via cookies`);
        console.log(`   ⏩ Tentando próximo método...`);
      }
    } catch (error) {
      console.error(`   ❌ Erro nos cookies:`, error instanceof Error ? error.message : error);
      console.log(`   ⏩ Tentando próximo método...`);
    }
    console.log('');
  }

  // Fallback não disponível — credenciais foram migradas para o store OAuth
  // (cada afiliado conectado tem seu próprio token)

  if (affiliateLink) {
    console.log('✅ Link de afiliado gerado!');
    console.log('──────────────────────────────────────────────');
    if (method) console.log(`Método: ${method}`);
    console.log(`📌 Original:   ${input}`);
    console.log(`🔗 Afiliado:   ${affiliateLink}`);
    console.log('──────────────────────────────────────────────');
  } else {
    console.error('❌ Nenhum método conseguiu gerar o link de afiliado.');
    console.error('');
    console.error('   Configure ao menos uma das estratégias no .env:');
    console.error('   1) ML_CLIENT_ID + ML_CLIENT_SECRET (± ML_REFRESH_TOKEN)');
    console.error('   2) ML_COOKIES');
    process.exit(1);
  }
}

main();
