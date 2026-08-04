/**
 * Gera hash scrypt de uma senha (para OMA_ADMIN_PASSWORD_HASH).
 *
 * Uso:
 *   bun run hash-password -- "minha-senha-forte"
 *   bun run hash-password            # pede via stdin (sem aparecer no shell)
 *
 * Obs: Bun.password suporta bcrypt, argon2id/argon2d/argon2i. Usamos
 * argon2id (mais forte que scrypt e nativo no Bun).
 */

import { hashPassword } from '../auth.ts';

async function main(): Promise<void> {
  const arg = process.argv[2]?.replace(/^--/, '');
  const password = arg ?? (await promptHidden());

  if (!password || password.length < 8) {
    console.error('A senha precisa ter pelo menos 8 caracteres.');
    process.exit(1);
  }

  const hash = await hashPassword(password);
  console.log('\nDefina em .env:');
  console.log(`OMA_ADMIN_PASSWORD_HASH=${hash}`);
}

async function promptHidden(): Promise<string> {
  // No Windows/git-bash o echo é visível; documentamos no README.
  // Alternativa sem TTY: passar a senha como argumento (não fica em log
  // do shell se você usar a forma com aspas).
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pw = await new Promise<string>((resolve) => rl.question('Senha: ', resolve));
  rl.close();
  return pw.trim();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
