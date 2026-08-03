/**
 * Helpers do simulador WhatsApp (escopo por instanceName).
 *
 * Cada teste opera sobre seu proprio instanceName ("user-{id}"). Assim,
 * workers paralelos nao colidem no estado global do simulador.
 */

const SIMULATOR_BASE =
  process.env.SIMULATOR_URL || `http://localhost:${process.env.SIMULATOR_PORT || '15446'}`;

export async function resetSimulatorInstance(instanceName: string): Promise<void> {
  const url = new URL('/__admin/reset', SIMULATOR_BASE);
  url.searchParams.set('instanceName', instanceName);
  await fetch(url.toString(), { method: 'POST' });
}

export interface SimMessage {
  instanceName: string;
  number: string;
  text: string;
  hasMedia?: boolean;
  mediaUrl?: string;
}

export async function getSimulatorMessagesFor(instanceName: string): Promise<SimMessage[]> {
  const url = new URL('/__admin/messages', SIMULATOR_BASE);
  url.searchParams.set('instanceName', instanceName);
  const res = await fetch(url.toString());
  const data = (await res.json()) as { success: boolean; messages: SimMessage[] };
  return data.messages ?? [];
}

export async function waitForMessagesOnInstance(
  instanceName: string,
  predicate: (msgs: SimMessage[]) => boolean,
  timeoutMs = 20000,
  intervalMs = 1000,
): Promise<SimMessage[]> {
  const start = Date.now();
  let last: SimMessage[] = [];
  while (Date.now() - start < timeoutMs) {
    last = await getSimulatorMessagesFor(instanceName);
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}
