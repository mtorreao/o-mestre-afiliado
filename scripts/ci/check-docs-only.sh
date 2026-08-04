#!/usr/bin/env bash
# Detecta se o diff (BASE...HEAD) contém apenas documentação/arquivos não-código.
#
# Uso: bash scripts/ci/check-docs-only.sh [BASE_SHA]
#   BASE_SHA vazio, ausente ou "0000...0" (primeiro push) → usa HEAD~1.
#   Requer checkout com fetch-depth: 0 (git diff precisa do histórico).
#
# Saída: imprime "docs_only=true" (pode pular CI) ou "docs_only=false" (rodar CI).
# Whitelist de código/infra: se QUALQUER arquivo do diff casa, o CI roda.
#
# Fail-closed: se o git diff falhar (base ausente, clone raso), o script sai
# com erro — o job falha em vez de pular o CI silenciosamente.
set -euo pipefail

BASE="${1:-}"
if [ -z "$BASE" ] || [ "$BASE" = "0000000000000000000000000000000000000000" ]; then
  BASE="HEAD~1"
fi

FILES=$(git diff --name-only "$BASE"...HEAD)

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
