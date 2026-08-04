#!/usr/bin/env bash
# Detecta se uma lista de arquivos (stdin, um por linha) contém apenas
# documentação/arquivos não-código.
#
# Uso: git diff --name-only A...B | bash scripts/ci/check-docs-only.sh
#   (o step do CI calcula o diff do PR/push e faz pipe aqui)
#
# Saída: imprime "docs_only=true" (pode pular CI) ou "docs_only=false" (rodar CI).
# Whitelist de código/infra: se QUALQUER arquivo da lista casar, o CI roda.
# Entrada vazia (sem mudanças) → docs_only=true.
set -euo pipefail

FILES=$(cat)

if [ -z "$FILES" ]; then
  echo "docs_only=true"
  exit 0
fi

# Código/infra = paths de workspace/CI + extensões de código/config.
# Tudo que não casa (docs/, *.md, imagens, assets...) é docs-only.
if echo "$FILES" | grep -qE '(^|/)(apps|packages|scripts|extensions|deploy|\.github|\.githooks)/|^\.env|\.(ts|tsx|js|jsx|mjs|cjs|json|css|html|yaml|yml|toml|sh|bash|prisma|sql|lock|py|go|rs)$'; then
  echo "docs_only=false"
else
  echo "docs_only=true"
fi
