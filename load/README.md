# load/ — Teste de carga (stack isolada + controle)

Stack mínima para testes de carga, isolada de dev (545x) e prod (544x):

| Serviço    | Container                   | Porta host | Limite CPU | Limite mem |
| ---------- | --------------------------- | ---------- | ---------- | ---------- |
| API        | omestre_loadtest_api        | 5502       | 1.0        | 1024M      |
| Ingestor   | omestre_loadtest_ingestor   | 5506       | 0.75       | 768M       |
| Dispatcher | omestre_loadtest_dispatcher | 5507       | 0.5        | 512M       |
| PostgreSQL | omestre_loadtest_postgres   | 5503       | 1.0        | 768M       |
| Redis      | omestre_loadtest_redis      | 5505       | 0.5        | 512M       |
| Evolution  | omestre_loadtest_evolution  | 5504       | 0.5        | 512M       |

Total: ~4.25 CPU / ~3.3 GB — cabe em máquina com 12 CPUs / 7.3 GB Docker
sem travar (os limites de recursos impedem OOM/stall).

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
