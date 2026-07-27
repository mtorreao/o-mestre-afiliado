/**
 * Lógica PURA do repositório de credenciais de usuário.
 *
 * Separa a construção do conjunto de campos a atualizar a partir do input
 * (campos undefined = não alterar) e a resolução dos valores de insert
 * (defaults null), que não dependem de DB, das operações de I/O. Funções
 * síncronas, 100% testáveis sem PostgreSQL.
 */

/**
 * Dados para criar ou atualizar credenciais.
 * Campos undefined = não alterar.
 */
export interface UserCredentialsInput {
  shopeeAppId?: string | null;
  shopeeAppSecret?: string | null;
}

/**
 * Constrói o objeto de update a partir do input, omitindo campos undefined.
 * Retorna `{}` quando nenhum campo foi informado (sem update).
 *
 * Comportamento exato do repo original: apenas `shopeeAppId`/`shopeeAppSecret`
 * são considerados; valores `null`/string são preservados.
 */
export function buildCredentialsUpdate(data: UserCredentialsInput): {
  shopeeAppId?: string | null;
  shopeeAppSecret?: string | null;
} {
  const updateData: { shopeeAppId?: string | null; shopeeAppSecret?: string | null } = {};
  if (data.shopeeAppId !== undefined) updateData.shopeeAppId = data.shopeeAppId;
  if (data.shopeeAppSecret !== undefined) updateData.shopeeAppSecret = data.shopeeAppSecret;
  return updateData;
}

/**
 * Resolve os valores para INSERT (novo registro) a partir do input.
 * Campos undefined viram `null` (default da tabela).
 */
export function buildCredentialsInsert(
  userId: number,
  data: UserCredentialsInput,
): { userId: number; shopeeAppId: string | null; shopeeAppSecret: string | null } {
  return {
    userId,
    shopeeAppId: data.shopeeAppId ?? null,
    shopeeAppSecret: data.shopeeAppSecret ?? null,
  };
}
