/**
 * Extension Routes — Endpoints para a extensão Chrome.
 *
 * Endpoints:
 *   POST /api/extension/offers/create — Criar oferta e enviar para grupos de destino
 */
import { Elysia, t } from 'elysia';
import { MirrorRepository, WhatsAppInstanceRepository } from '@omestre/db';
import { createJwtPlugin, getAuthUser } from '../../middleware/auth.ts';
import { instanceNameFromUserId } from '../../services/evolution.ts';
import { convertMarketplaceUrl } from './extension.service.ts';

const mirrorRepo = new MirrorRepository();
const instanceRepo = new WhatsAppInstanceRepository();

export const extensionRoutes = new Elysia()
  .use(createJwtPlugin())

  // ─── POST /api/extension/offers/create — Criar oferta ───────────────
  .post(
    '/api/extension/offers/create',
    async ({ jwt, request, set, body }) => {
      const auth = await getAuthUser(jwt, request.headers);
      if (!auth) {
        set.status = 401;
        return { success: false, error: 'Não autenticado' };
      }

      const { url, marketplace, title, productName, coupon, priceFrom, priceTo } = body as {
        url: string;
        marketplace?: string;
        title?: string;
        productName?: string;
        coupon?: string;
        priceFrom?: string;
        priceTo?: string;
      };

      if (!url) {
        set.status = 400;
        return { success: false, error: 'URL é obrigatória' };
      }

      // 1. Converter URL para link de afiliado
      const conversion = await convertMarketplaceUrl(url, marketplace);
      if (!conversion.success) {
        set.status = 200; // erro de negócio
        return { success: false, error: conversion.error || 'Falha na conversão do link' };
      }

      // 2. Busca espelhamentos ativos do usuário
      const result = await mirrorRepo.list({
        status: 'active',
        userId: auth.userId,
        pageSize: 100,
      });
      const activeMirrors = result.rows.filter((m) => m.targetGroups && m.targetGroups.length > 0);
      if (activeMirrors.length === 0) {
        return {
          success: false,
          error: 'Nenhum espelhamento ativo com grupos de destino encontrado',
          convertedUrl: conversion.convertedUrl,
        };
      }

      // 3. Montar mensagem com template fixo
      const lines: string[] = [];
      if (title) lines.push(`🔥 *${title}*`);
      if (lines.length > 0 && (productName || conversion.convertedUrl)) lines.push('');
      if (productName) lines.push(`📦 *${productName}*`);
      if (priceFrom) lines.push(`~~ De: ${priceFrom} ~~`);
      if (priceTo) lines.push(`🔥 Por: *${priceTo}*`);
      if (coupon) lines.push(`🏷️ Cupom: *${coupon}*`);
      if (lines.length > 0 && conversion.convertedUrl) lines.push('');
      if (conversion.convertedUrl) lines.push(`🔗 ${conversion.convertedUrl}`);

      const message = lines.join('\n');

      // 4. Encontrar a instância Evolution do usuário
      const instanceName = instanceNameFromUserId(auth.userId);
      const instance = await instanceRepo.findByInstanceName(instanceName);
      if (!instance) {
        return {
          success: false,
          error: 'Instância WhatsApp não encontrada. Conecte sua conta primeiro.',
          convertedUrl: conversion.convertedUrl,
        };
      }

      // 5. Import dinâmico do cliente Evolution (evita circular deps)
      const { sendGroupMessage } = await import('../../services/evolution.ts');

      // 6. Enviar para todos os grupos de destino
      const targetGroups: { jid: string; name: string }[] = [];
      for (const mirror of activeMirrors) {
        const groups = mirror.targetGroups as { jid: string; name: string }[] | null;
        if (groups) targetGroups.push(...groups);
      }

      // Deduplica grupos (mesmo JID em múltiplos espelhamentos)
      const seen = new Set<string>();
      const uniqueGroups = targetGroups.filter((g) => {
        const key = g.jid;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const sentTo: { groupJid: string; groupName: string; status: string }[] = [];

      for (const group of uniqueGroups) {
        try {
          const evoRes = await sendGroupMessage(instanceName, group.jid, message);
          sentTo.push({
            groupJid: group.jid,
            groupName: group.name,
            status: evoRes.success ? 'sent' : 'error',
          });
        } catch {
          sentTo.push({
            groupJid: group.jid,
            groupName: group.name,
            status: 'error',
          });
        }

        // Pequeno delay entre envios
        if (uniqueGroups.length > 1) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      return {
        success: true,
        convertedUrl: conversion.convertedUrl,
        sentTo,
      };
    },
    {
      body: t.Object({
        url: t.String({ minLength: 1 }),
        marketplace: t.Optional(t.String()),
        title: t.Optional(t.String()),
        productName: t.Optional(t.String()),
        coupon: t.Optional(t.String()),
        priceFrom: t.Optional(t.String()),
        priceTo: t.Optional(t.String()),
      }),
    },
  );
