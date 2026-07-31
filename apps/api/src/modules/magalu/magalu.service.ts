/**
 * Magalu Service — Repositório singleton + helpers compartilhados
 * para as rotas de Magalu (Influenciador Magalu / Magazine Você).
 */
import { MagaluAffiliateRepository } from '@omestre/db';

export const magaluRepo = new MagaluAffiliateRepository();
