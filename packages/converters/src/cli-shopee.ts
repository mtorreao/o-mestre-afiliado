#!/usr/bin/env bun
/**
 * CLI para conversão de links Shopee
 *
 * Uso: bun run packages/converters/src/cli-shopee.ts <url>
 */

import { generateShortLink } from './shopee.ts';

function printHelp() {
  console.log(`
╔══════════════════════════════════════════╗
║   Shopee Affiliate Link Converter        ║
╚══════════════════════════════════════════╝

USO:
  bun run shopee <url_do_produto>

EXEMPLOS:
  bun run shopee "https://shopee.com.br/product/123/456"
  bun run shopee "https://shopee.com.br/Produto-X-i.123.456"

CREDENCIAIS (.env):
  SHOPEE_APP_ID   - App ID do programa de afiliados
  SHOPEE_SECRET   - App Secret do programa de afiliados
`);
}

async function main() {
  const url = process.argv[2];

  if (!url) {
    printHelp();
    process.exit(1);
  }

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Shopee Affiliate Link Converter        ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  try {
    const result = await generateShortLink(url);
    if (result) {
      console.log('');
      console.log('✅ Link de afiliado gerado com sucesso!');
      console.log('──────────────────────────────────────');
      console.log(`📌 Original:   ${url}`);
      console.log(`🔗 Afiliado:   ${result}`);
      console.log('──────────────────────────────────────');
    } else {
      console.error('❌ Falha ao gerar link de afiliado');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Erro:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
