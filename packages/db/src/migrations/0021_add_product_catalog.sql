-- Migration: 0021_add_product_catalog.sql
-- Catálogo de produtos + variações + histórico de preços.
-- Especificação: docs/plans/historico-precos.md §2.1-2.3
--
-- products           — normalização de produto (1 linha por marketplace:itemId)
-- product_variations — variações de um produto (1:N)
-- price_history      — pontos de preço append-only por variação (dedup 1h via índice único)
--
-- Nota: o tipo marketplace é o enum do schema public (criado na migration 0000),
-- resolvido via search_path — por isso sem qualificação.

CREATE TABLE IF NOT EXISTS omestre.products (
  id                  serial PRIMARY KEY,
  marketplace         marketplace NOT NULL,
  marketplace_item_id text NOT NULL,
  product_key         text NOT NULL UNIQUE,          -- "${marketplace}:${marketplace_item_id}" (dedup real)
  title               text,
  image_url           text,
  created_at          timestamp NOT NULL DEFAULT now(),
  updated_at          timestamp NOT NULL DEFAULT now(),
  last_seen_at        timestamp NOT NULL DEFAULT now()
);

-- Índice parcial p/ upsert rápido (redundante com UNIQUE da coluna, mantido por spec)
CREATE UNIQUE INDEX IF NOT EXISTS products_key_idx ON omestre.products (product_key);

CREATE TABLE IF NOT EXISTS omestre.product_variations (
  id               serial PRIMARY KEY,
  product_id       integer NOT NULL REFERENCES omestre.products(id) ON DELETE CASCADE,
  variation_key    text NOT NULL,                     -- "${product_key}:${vId}" (vId do MP ou hash do nome)
  variation_id     text,                              -- id da variação no MP (ML: variation_id; Shopee/Amazon: null)
  variation_name   text,                              -- "Azul / M" ou "Conjunto 3un" (label legível)
  attributes_json  jsonb DEFAULT '{}',                -- atributos crus (cor, tamanho, voltagem...)
  created_at       timestamp NOT NULL DEFAULT now(),
  last_seen_at     timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_variations_key_idx
  ON omestre.product_variations (variation_key);

CREATE TABLE IF NOT EXISTS omestre.price_history (
  id               serial PRIMARY KEY,
  variation_id     integer NOT NULL REFERENCES omestre.product_variations(id) ON DELETE CASCADE,
  price            numeric(12,2) NOT NULL,
  list_price       numeric(12,2),                     -- preço de tachado/original (ML: original_price); null se indisponível
  currency         text NOT NULL DEFAULT 'BRL',
  available        boolean NOT NULL DEFAULT true,     -- false = esgotado
  stock            integer,                           -- qtd disponível (ML sim; Shopee/others null)
  price_bucket     timestamp NOT NULL,                -- date_trunc('hour', captured_at) — deduplicação
  captured_at      timestamp NOT NULL DEFAULT now(),
  source           text NOT NULL DEFAULT 'background', -- 'background' | 'manual' | 'api' | 'backfill'
  source_group_jid text,                              -- grupo de onde veio (contexto)
  message_id       text                               -- msgId original (rastreabilidade)
);

-- Dedup de corrida + janela de 1h: conflitos não inserem (ON CONFLICT DO NOTHING no worker)
-- NULLS NOT DISTINCT (PG15+): sem ele, list_price NULL (Shopee/Amazon) nunca
-- conflita num índice UNIQUE — o dedup de 1h simplesmente não funcionaria.
CREATE UNIQUE INDEX IF NOT EXISTS price_history_dedup_idx
  ON omestre.price_history (variation_id, price_bucket, price, list_price, available)
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS price_history_variation_idx
  ON omestre.price_history (variation_id, captured_at);
