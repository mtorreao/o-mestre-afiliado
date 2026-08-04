#!/usr/bin/env bash
# Detecta se o diff (BASE...HEAD) contém apenas documentação/arquivos não-código.
#
# Uso: bash scripts/ci/check-docs-only.sh [BASE_SHA]
#   BASE_SHA vazio, ausente ou "0000...0" (primeiro push) → usa HEAD~1.
#
# Saída: imprime "docs_only=true" (pode pular CI) ou "docs_only=false" (rodar CI).
# Whitelist de código/infra: se QUALQUER arquivo do diff casa, o CI roda.
set -euo pipefail

BASE="${1:-}"
if [ -z "$BASE" ] || [ "$BASE" = "0000000000000000000000000000000000000000" ]; then
  BASE="HEAD~1"
fi

FILES=$(git diff --name-only "$BASE"...HEAD || true)

# Código/infra = paths de workspace/CI + extensões de código/config.
# Tudo que não casa (docs/, *.md, imagens, assets...) é docs-only.
if [ -z "$FILES" ] || ! echo "$FILES" | grep -qE '(^|/)(apps|packages|scripts|extensions|deploy|\.github|\.githooks)/|^\.env|\.(ts|tsx|js|jsx|mjs|cjs|json|css|html|yaml|yml|toml|sh|bash|prisma|sql|lock|py|go|rs)$'; then
  echo "docs_only=true"
else
  echo "docs_only=false"
fi
