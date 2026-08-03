# load/ — Teste de carga (stack isolada + controle)

Stack mínima para testes de carga, isolada de dev (545x) e prod (544x):

| Serviço    | Container                   | Porta host | Limite CPU | Limite mem |
| ---------- | --------------------------- | ---------- | ---------- | ---------- |
| API        | omestre_loadtest_api        | 5502       | 0.7        | 768M       |
| Ingestor   | omestre_loadtest_ingestor   | 5506       | 0.5        | 512M       |
| Dispatcher | omestre_loadtest_dispatcher | 5507       | 0.3        | 256M       |
| PostgreSQL | omestre_loadtest_postgres   | 5503       | 0.6        | 768M       |
| Redis      | omestre_loadtest_redis      | 5505       | 0.3        | 256M       |
| Evolution  | omestre_loadtest_evolution  | 5504       | 0.3        | 384M       |

Total: ~2.7 CPU / ~2.9 GB — simula um host de 4 vCPU / 8 GB RAM (VPS pequeno).
Sobra ~1.3 vCPU / ~5 GB pro Docker, OS e buffers; os limites impedem OOM/stall.

## Fluxo completo (8 cenários)

`flow` encadeia todos os cenários na ordem do ciclo de vida do usuário e
imprime um resumo final com o SLO de cada etapa:

| Etapa | Cenário              | O que exercita                          |
| ----- | -------------------- | --------------------------------------- |
| 1     | onboarding-auth-flow | register + login + refresh + /me        |
| 2     | affiliate-crud       | PUT profile + test-conversion + logs    |
| 3     | webhook-ingest-burst | hot path (mensagens reais)              |
| 4     | webhook-secondary    | connection/qrcode/groups updates        |
| 5     | webhook-ignored      | grupos não monitorados (cache negativo) |
| 6     | webhook-malformed    | payloads quebrados (rejeição graciosa)  |
| 7     | webhook-login-mixed  | webhook + login misturados              |
| 8     | dashboard-reads      | leituras autenticadas de painel         |

```bash
bun run load/loadtest-control.ts flow
```

## Resultado de referência (stack loadtest, 4 vCPU / 8 GB, 2026-08-03)

`flow` contra `http://localhost:5502` (limites: api 0.7 CPU / 768 MB):

| Etapa | Cenário              | 2xx | 4xx | 5xx | p95  | SLO |
| ----- | -------------------- | --- | --- | --- | ---- | --- |
| 1     | onboarding-auth-flow | 3   | 37  | 0   | 1610 | ✅  |
| 2     | affiliate-crud       | 60  | 0   | 0   | 10   | ✅  |
| 3     | webhook-ingest-burst | 200 | 0   | 0   | 20   | ✅  |
| 4     | webhook-secondary    | 80  | 0   | 0   | 13   | ✅  |
| 5     | webhook-ignored      | 100 | 0   | 0   | 14   | ✅  |
| 6     | webhook-malformed    | 60  | 0   | 0   | 11   | ✅  |
| 7     | webhook-login-mixed  | 76  | 24  | 0   | 2849 | ✅  |
| 8     | dashboard-reads      | 40  | 20  | 0   | 16   | ✅  |

Notas:

- Os 4xx do onboarding (409/401) são esperados em rodadas repetidas (users já
  cadastrados). O SLO monitora transporte + 5xx.
- p95 alto em auth (1.6s / 2.8s) é o bcrypt (10 rounds) com CPU limitado —
  custo real de register/login, não um vazamento.
- Os 20×4xx do dashboard-reads são `/api/auth/me` com token de outro user
  (rota exige o dono do token); worker/status e mirrors dão 200.

## Uso rápido

```bash
# 1. Builda e sobe a stack
bun run load/loadtest-control.ts up --build

# 2. Espera a API ficar saudável
bun run load/loadtest-control.ts wait

# 3. Roda o ramp-up (webhook) com 5 estágios
bun run load/loadtest-control.ts ramp --stages "5:10,25:10,50:10,100:10,200:10"

# 4. Roda a comparação A/B (ex.: baseline vs. nova imagem)
bun run load/loadtest-control.ts compare http://localhost:5442 http://localhost:5502

# 5. Derruba (com -v remove volumes/estado)
bun run load/loadtest-control.ts down -v
```

## Comandos

| Comando                | Descrição                                   |
| ---------------------- | ------------------------------------------- |
| `up [--build]`         | Builda (se --build) e sobe a stack          |
| `down [-v]`            | Derruba (-v remove volumes)                 |
| `status`               | Containers da stack                         |
| `logs [svc] [-f]`      | Logs (ex.: `logs api -f`)                   |
| `wait [--api-url URL]` | Espera healthcheck da API                   |
| `smoke`                | Loadtest contra o mock interno (sem stack)  |
| `ramp [--stages SPEC]` | Ramp-up contra a stack (default 5 estágios) |
| `compare <A> <B>`      | Rampa contra 2 targets e imprime tabela     |
| `ps`                   | `docker stats` dos containers               |

## Variáveis

- `LOADTEST_COMPOSE_FILE` — compose (default `load/docker-compose.loadtest.yml`)
- `LOADTEST_PROJECT` — nome do projeto compose (default `omestre-loadtest`)
- `LOADTEST_ENV_FILE` — env file (default `load/.env`, fallback `../.env`)

## Fluxo recomendado de go-live

1. `up --build` (builda a branch atual)
2. `ramp` → registra a capacidade da imagem nova
3. `compare <baseline> <nova>` → delta de throughput/latência
4. `down -v` ao terminar

> ⚠️ Os SLOs são definidos em `apps/loadtest/src/scenarios/index.ts`
> (p95 < 500ms, p99 < 1000ms, erros < 2%, 5xx < 1%, rps >= 50 p/ webhook).
