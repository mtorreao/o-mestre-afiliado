#!/usr/bin/env bash
# setup-hooks.sh — Configura .githooks/ como diretório de hooks do Git.
#
# Uso:
#   bun run setup:hooks
#
# Efeito: `git config core.hooksPath .githooks` — todos os hooks
# versionados no repo passam a ser executados automaticamente.
# Idempotente: pode rodar quantas vezes quiser.

set -e

ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$ROOT/.githooks"

if [ ! -d "$HOOKS_DIR" ]; then
  echo "❌ Diretório $HOOKS_DIR não encontrado"
  exit 1
fi

# Garante permissão de execução em todos os hooks
chmod +x "$HOOKS_DIR"/*

# Configura o Git para usar .githooks/
git config core.hooksPath .githooks

echo "✅ Hooks Git configurados para $HOOKS_DIR"
echo ""
echo "Hooks ativos:"
for hook in "$HOOKS_DIR"/*; do
  if [ -f "$hook" ] && [ -x "$hook" ]; then
    echo "  - $(basename "$hook")"
  fi
done
