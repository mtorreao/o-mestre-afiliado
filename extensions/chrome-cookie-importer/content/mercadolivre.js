/**
 * Content script — Mercado Livre
 * Extrai dados do produto da página para o popup da extensão.
 * Executa em páginas de produto ML (MLB-*, MLBU*, /p/MLB*).
 */
(function () {
  'use strict';

  function extractMLProduct() {
    const url = window.location.href;

    // Tenta extrair via schema JSON-LD (mais confiável)
    const ld = document.querySelector('script[type="application/ld+json"]');
    let name = '';
    let price = '';

    if (ld) {
      try {
        const data = JSON.parse(ld.textContent || '{}');
        if (data.name) name = data.name;
        if (data.offers?.price) price = String(data.offers.price);
      } catch {
        /* fallback abaixo */
      }
    }

    // Fallback: DOM
    if (!name) {
      const h1 = document.querySelector('h1');
      if (h1) name = h1.textContent?.trim() || '';
    }

    // Preço via ui-pdp-price
    if (!price) {
      const priceEl =
        document.querySelector('[itemprop="price"]') ||
        document.querySelector('.andes-money-amount__fraction') ||
        document.querySelector('.ui-pdp-price__second-line .andes-money-amount__fraction');
      if (priceEl) {
        price =
          priceEl.getAttribute('content') ||
          priceEl.textContent?.trim()?.replace(/[^0-9,.]/g, '') ||
          '';
      }
    }

    // Imagem
    const img =
      document.querySelector('meta[property="og:image"]') ||
      document.querySelector('figure.ui-pdp-gallery__figure img');
    const imageUrl = img ? img.getAttribute('content') || img.getAttribute('src') || '' : '';

    return {
      marketplace: 'mercadolivre',
      url,
      name,
      price,
      imageUrl,
    };
  }

  // Envia para o service worker / popup
  chrome.runtime.sendMessage({
    type: 'product-data',
    data: extractMLProduct(),
  });
})();
