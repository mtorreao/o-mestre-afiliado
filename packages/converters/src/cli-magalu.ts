#!/usr/bin/env bun
/**
 * CLI para conversão de links Magalu (Magazine Luiza / Magazine Você)
 *
 * Uso: bun run magalu <url>
 *
 * Lê MAGALU_STORE_NAME do .env (fallback global do programa Influenciador
 * Magalu). Sem o slug configurado, o conversor retorna erro descritivo.
 */

import { convertMagaluUrl } from './magalu.ts';

function printHelp() {
  console.log(`
╔══════════════════════════════════════════╗
║   Magalu Affiliate Link Converter        ║
╚══════════════════════════════════════════╝

USO:
  bun run magalu <url_do_produto>

EXEMPLOS:
  bun run magalu "https://www.magazineluiza.com.br/celular-x/p/12345/"
  bun run magalu "https://maga.lu/abc123"

CREDENCIAIS (.env):
  MAGALU_STORE_NAME - Slug da loja no Magazine Você
                      (nome da loja do programa Influenciador Magalu,
                      ex: "magazinetorre")
`);
}

async function main() {
  const url = process.argv[2];

  if (!url || url === '--help' || url === '-h') {
    printHelp();
    process.exit(url ? 0 : 1);
  }

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Magalu Affiliate Link Converter        ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  try {
    const result = await convertMagaluUrl(url);
    if (result.success && result.affiliateUrl) {
      console.log('');
      console.log('✅ Link de afiliado gerado com sucesso!');
      console.log('──────────────────────────────────────');
      console.log(`📌 Original:   ${result.originalUrl}`);
      console.log(`🔗 Afiliado:   ${result.affiliateUrl}`);
      console.log(`🧭 Método:     ${result.method}`);
      console.log('──────────────────────────────────────');
    } else {
      console.error('❌ Falha ao gerar link de afiliado');
      if (result.error) console.error(`   ${result.error}`);
      if (!process.env.MAGALU_STORE_NAME) {
        console.error('');
        console.error('   Configure MAGALU_STORE_NAME no .env:');
        console.error('   MAGALU_STORE_NAME=magazineseunome');
      }
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Erro:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
