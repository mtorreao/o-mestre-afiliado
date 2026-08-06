# Blacklist / Whitelist do Ingestor

Listas de termos que filtram mensagens no pipeline de espelhamento.

## Formato

```json
{
  "terms": ["termo1", "termo2", "termo3"]
}
```

Match é case-insensitive e aceita palavra inteira ou substring (ver `apps/ingestor/src/terms-lists-pure.ts`).

## Semântica

- **blacklist**: termos que BLOQUEIAM uma oferta. Ex.: "vagas", "emprego", "aluguel".
- **whitelist**: termos que APROVAM mesmo com match na blacklist. Útil para forçar
  a passagem de categorias que de outra forma seriam filtradas.

## Comportamento

- Arquivos com `"terms": []` (vazios) desabilitam o filtro correspondente.
- Arquivos ausentes são tolerados pelo ingestor (lê lista vazia).
- Mudanças só aplicam após reiniciar o container (`docker compose restart ingestor`).

## Exemplo

`blacklist.json`:
```json
{ "terms": ["vagas", "emprego", "aluguel", "curso"] }
```

`whitelist.json`:
```json
{ "terms": ["curso gratuito", "vagas pcd"] }
```
