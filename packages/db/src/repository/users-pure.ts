/**
 * Lógica PURA do repositório de usuários.
 *
 * Separa o mapeamento para dados públicos (remoção de password_hash, que
 * não depende de DB) das operações de I/O. Função síncrona, 100% testável
 * sem PostgreSQL.
 */

export interface UserPublic {
  id: number;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Retorna os dados públicos de um User (remove password_hash).
 * Lança se o usuário for nulo (o repo original só chama após checagem).
 */
export function toUserPublic(user: {
  id: number;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  passwordHash: string;
}): UserPublic {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
