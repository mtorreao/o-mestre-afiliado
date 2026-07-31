import { Elysia, t } from 'elysia';
import { UserRepository, UserCredentialsRepository, isEmailAdminAllowed } from '@omestre/db';
import { createJwtPlugin, getAuthUser } from '../../middleware/auth.ts';
import { config } from '../../config.ts';

const userRepo = new UserRepository();
const credentialsRepo = new UserCredentialsRepository();

export const authRoutes = new Elysia()
  // ─── Plugin JWT ───────────────────────────────────────────────────
  .use(createJwtPlugin())

  // ─── POST /api/auth/register ──────────────────────────────────────
  .post(
    '/api/auth/register',
    async ({ body, jwt, set }) => {
      const { email, name, password } = body as { email: string; name: string; password: string };

      if (!email || !name || !password) {
        set.status = 400;
        return { success: false, error: 'Email, nome e senha são obrigatórios' };
      }

      if (password.length < 6) {
        set.status = 400;
        return { success: false, error: 'Senha deve ter pelo menos 6 caracteres' };
      }

      const existing = await userRepo.findByEmail(email);
      if (existing) {
        set.status = 409;
        return { success: false, error: 'Email já cadastrado' };
      }

      const passwordHash = await Bun.password.hash(password);
      // Admin bootstrap via env: emails em ADMIN_EMAILS nascem admin.
      const isAdmin = isEmailAdminAllowed(email, config.ADMIN_EMAILS);
      const user = await userRepo.create({ email, name, passwordHash, isAdmin });

      await credentialsRepo.upsert(user.id, {});

      const token = await jwt.sign({ userId: user.id, userEmail: user.email, isAdmin });

      return {
        success: true,
        token,
        user: { id: user.id, email: user.email, name: user.name, isAdmin },
      };
    },
    {
      detail: {
        summary: 'Registrar novo usuário',
        description: 'Cria uma conta com email e senha',
      },
    },
  )

  // ─── POST /api/auth/login ─────────────────────────────────────────
  .post(
    '/api/auth/login',
    async ({ body, jwt, set }) => {
      const { email, password } = body as { email: string; password: string };

      if (!email || !password) {
        set.status = 400;
        return { success: false, error: 'Email e senha são obrigatórios' };
      }

      const user = await userRepo.findByEmail(email);
      if (!user) {
        set.status = 401;
        return { success: false, error: 'Email ou senha inválidos' };
      }

      const valid = await Bun.password.verify(password, user.passwordHash);
      if (!valid) {
        set.status = 401;
        return { success: false, error: 'Email ou senha inválidos' };
      }

      // Admin bootstrap via env: se o email entrou em ADMIN_EMAILS depois do
      // cadastro, promove no DB (idempotente) e usa o valor atualizado no JWT.
      // Se o email foi removido da lista, mantém o valor atual do DB.
      // Fail-closed: se o UPDATE não retornar linha (e-mail sumiu do banco
      // entre o find e o UPDATE, etc.), cai pro default seguro (false) em
      // vez de presentear o usuário com admin.
      let isAdmin = user.isAdmin;
      if (!isAdmin && isEmailAdminAllowed(email, config.ADMIN_EMAILS)) {
        const updated = await userRepo.promoteToAdmin(email);
        isAdmin = updated?.isAdmin ?? false;
      }

      const token = await jwt.sign({ userId: user.id, userEmail: user.email, isAdmin });

      return {
        success: true,
        token,
        user: { id: user.id, email: user.email, name: user.name, isAdmin },
      };
    },
    {
      detail: {
        summary: 'Fazer login',
        description: 'Autentica com email e senha, retorna JWT',
      },
    },
  )

  // ─── GET /api/auth/me ─────────────────────────────────────────────
  .get(
    '/api/auth/me',
    async ({ jwt, request, set }) => {
      const auth = await getAuthUser(jwt, request.headers);
      if (!auth) {
        set.status = 401;
        return { success: false, error: 'Não autenticado' };
      }

      const user = await userRepo.findPublicById(auth.userId);
      if (!user) {
        return { success: false, error: 'Usuário não encontrado' };
      }

      return { success: true, user };
    },
    {
      detail: {
        summary: 'Dados do usuário logado',
        description: 'Retorna os dados do usuário autenticado',
      },
    },
  );
