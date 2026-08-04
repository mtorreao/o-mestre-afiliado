/**
 * group-resolution.ts — resolução do nome de grupo de origem.
 *
 * Desacopla a chamada à Evolution API do caminho quente do webhook (opção B
 * do plano de remediação de carga). O webhook publica o RawMessageEvent com
 * o nome vindo do cache Redis; o INGESTOR resolve o nome via Evolution (quando
 * vazio) em seu próprio loop assíncrono, sem bloquear o webhook.
 *
 * A lógica de I/O fica aqui; o parse da resposta é puro (inline, trivial).
 */
import { config } from './config.ts';
import { buildEvolutionHeaders } from './notifier-pure.ts';

/**
 * Resolve o nome de um grupo via Evolution API.
 *
 * @param instanceName nome da instância (ex: "user-1")
 * @param groupJid JID do grupo (ex: "120363...@g.us")
 * @param cachedName nome já conhecido do cache; se não vazio, NÃO chama a
 *        Evolution (evita I/O externo desnecessário).
 * @returns nome resolvido ou '' se não foi possível resolver.
 */
export async function resolveGroupName(
  instanceName: string,
  groupJid: string,
  cachedName?: string,
): Promise<string> {
  if (cachedName && cachedName.length > 0) return cachedName;

  const base = (config.EVOLUTION_API_URL ?? '').replace(/\/$/, '');
  if (!base) return '';

  const url = `${base}/group/groupInfo/${encodeURIComponent(instanceName)}/${encodeURIComponent(groupJid)}`;
  try {
    const res = await fetch(url, { method: 'GET', headers: buildEvolutionHeaders() });
    if (!res.ok) return '';
    const data = (await res.json()) as Record<string, unknown>;
    const name = String(data.name ?? data.subject ?? '');
    return name;
  } catch {
    // Falha silenciosa — Evolution indisponível não deve quebrar o pipeline.
    return '';
  }
}
