/**
 * Helpers compartilhados dos testes E2E.
 *
 * Quebrado em modulos por responsabilidade:
 *   - api-base:  URL da API, identidade de teste, criacao de usuario via register
 *   - auth:      helpers HTTP autenticados (authGet/Post/Put/Patch/Delete)
 *   - simulator: helpers do simulador WhatsApp (escopo por instanceName)
 *
 * Este index reexporta tudo para permitir imports limpos:
 *   import { createTestUser, authPost, resetSimulatorInstance } from '../helpers/index.ts';
 */

export { API_BASE, uniqueEmail, TEST_PASSWORD, TEST_NAME, createTestUser } from './api-base.ts';

export { authGet, authPost, authPut, authPatch, authDelete } from './auth.ts';

export {
  resetSimulatorInstance,
  getSimulatorMessagesFor,
  waitForMessagesOnInstance,
  type SimMessage,
} from './simulator.ts';
