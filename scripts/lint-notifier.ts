#!/usr/bin/env bun
/**
 * Lint custom — detecta typos em `classifyConversionError`.
 *
 * Anti-pattern: o matcher de erros para um marketplace retornando um
 * FailureType de OUTRO marketplace. Exemplo real (já ocorreu):
 *
 *   if (marketplace === 'amazon') {
 *     if (err.includes('tracking') || ...) {
 *       return 'invalid_shopee_creds';   // ❌ deveria ser 'invalid_amazon_tracking_id'
 *     }
 *   }
 *
 * Isso faz o sistema notificar o usuário com "credenciais Shopee inválidas"
 * quando o problema real é tracking ID da Amazon — você vê a notificação,
 * reconfigura Shopee, e nada muda.
 *
 * REGRA: dentro de `if (marketplace === 'X')`, o `return '...'` só pode
 * referenciar tipos cujo nome comece com `${X}_` ou contenha `${X}`.
 * Exceção: tipos genéricos compartilhados (cookie_expired, evolution_api_offline,
 * network_timeout, dedup, blacklist).
 *
 * Exit codes:
 *   0 — sem violações
 *   1 — violação encontrada (mostra arquivo:linha)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const NOTIFIER_FILES = [
  'packages/worker-common/src/notifier.ts',
  'apps/worker/src/notifier.ts',
];

const ALLOWED_GENERIC_TYPES = new Set([
  'cookie_expired',
  'refresh_token_expired',
  'ml_account_not_linked',
  'evolution_api_offline',
  'network_timeout',
  'dedup',
  'blacklist',
]);

const MARKETPLACES = ['shopee', 'amazon', 'mercadolivre', 'ml'] as const;
type Marketplace = (typeof MARKETPLACES)[number];

type Violation = {
  file: string;
  line: number;
  context: string;
  marketplace: Marketplace;
  wrongType: string;
};

const violations: Violation[] = [];

function checkFile(absPath: string): void {
  if (!existsSync(absPath)) return;
  const content = readFileSync(absPath, 'utf-8');
  const lines = content.split('\n');

  // Encontra blocos `if (marketplace === 'X') { ... return 'TYPE'; ... }`
  // Estratégia simples: encontrar linhas com `marketplace === 'X'`, depois
  // nas próximas ~20 linhas, encontrar `return 'TIPO'` e validar.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const mpMatch = line.match(/marketplace\s*===\s*['"](\w+)['"]/);
    if (!mpMatch) continue;
    const marketplace = mpMatch[1] as Marketplace;
    if (!MARKETPLACES.includes(marketplace)) continue;

    // Encontra o `return 'TIPO'` no mesmo bloco (até `}` de fechamento)
    let depth = 0;
    for (let j = i; j < Math.min(i + 30, lines.length); j++) {
      const blockLine = lines[j]!;
      depth += (blockLine.match(/{/g) || []).length;
      depth -= (blockLine.match(/}/g) || []).length;

      const returnMatch = blockLine.match(/return\s+['"]([\w_]+)['"]\s*;/);
      if (returnMatch) {
        const returnedType = returnMatch[1]!;
        if (ALLOWED_GENERIC_TYPES.has(returnedType)) break;

        // Verifica se o tipo referencia o marketplace correto
        const hasMarketplaceRef =
          returnedType.includes(marketplace) ||
          (marketplace === 'ml' && returnedType.includes('mercadolivre')) ||
          (marketplace === 'mercadolivre' && returnedType.includes('ml'));

        if (!hasMarketplaceRef) {
          violations.push({
            file: relative(process.cwd(), absPath),
            line: j + 1,
            context: blockLine.trim(),
            marketplace,
            wrongType: returnedType,
          });
        }
        break;
      }

      if (depth <= 0 && j > i) break;
    }
  }
}

console.log('🔍 Lint notifier — verificando tipos de FailureType por marketplace...\n');

for (const rel of NOTIFIER_FILES) {
  const abs = resolve(process.cwd(), rel);
  checkFile(abs);
}

if (violations.length === 0) {
  console.log('✅ Nenhuma violação encontrada.\n');
  process.exit(0);
}

console.error(`❌ ${violations.length} violação(ões):\n`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    marketplace === '${v.marketplace}'`);
  console.error(`    ${v.context}`);
  console.error(`    ⚠️  '${v.wrongType}' não referencia '${v.marketplace}'`);
  console.error('');
}
console.error(
  'Cada marketplace deve ter seu próprio tipo de falha (ex: amazon → invalid_amazon_tracking_id).',
);
console.error(
  'Tipos genéricos (cookie_expired, evolution_api_offline, etc.) são compartilhados e OK.',
);
process.exit(1);