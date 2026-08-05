/**
 * Wrapper local fino sobre `getFlagRedis` do `@omestre/feature-flags-sdk`.
 *
 * Centraliza o acesso ao Redis de feature-flags dentro do admin-api para
 * que mudanças no SDK exijam só 1 ponto de alteração (este arquivo).
 *
 * Sem fallback custom: o SDK já implementa lazy singleton + fail-open
 * (retorna `null` se Redis offline). Quem chama aqui já lida com `null`.
 */

import { getFlagRedis } from '@omestre/feature-flags-sdk';

export { getFlagRedis };
