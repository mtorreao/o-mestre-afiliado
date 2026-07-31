// Script de validação: roda o regex do nosso fix contra HTMLs reais capturados
// do log do ingestor. Espera-se {sanitized_title} rejeitado e URL real aceita.

const htmlTemplate =
  '<meta property="og:image" content="https://http2.mlstatic.com/D_Q_NP_727559-MLA99590035560_122025-AB{sanitized_title}.webp"/>';
const htmlReal =
  '<meta property="og:image" content="https://http2.mlstatic.com/D_NQ_NP_633037-MLB77982712035_072024-O.webp"/>';

const re =
  /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*?content=["']([^"']+)["']/i;

function extract(html: string): string | null {
  const m = html.match(re);
  if (!m?.[1]) return null;
  const value = m[1].trim();
  if (/\{[^}]+\}/.test(value)) return null;
  return value;
}

const r1 = extract(htmlTemplate);
const r2 = extract(htmlReal);

console.log('=== Template {sanitized_title} (esperado: null) ===');
console.log('Res:', r1);
console.log('OK:', r1 === null ? '✓' : '✗ FALHOU');

console.log();
console.log('=== URL real D_NQ_NP (esperado: URL preservada) ===');
console.log('Res:', r2);
console.log('OK:', r2 === htmlReal.match(re)![1] ? '✓' : '✗ FALHOU');

if (r1 !== null || r2 !== htmlReal.match(re)![1]) {
  process.exit(1);
}
console.log('\n✓ Fix válido');
