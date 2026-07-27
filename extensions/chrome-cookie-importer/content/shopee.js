(function () {
  'use strict';

  function extractShopeeProduct() {
    const url = window.location.href;

    const ld = document.querySelector('script[type="application/ld+json"]');
    let name = '';
    let price = '';

    if (ld) {
      try {
        const data = JSON.parse(ld.textContent || '{}');
        if (data.name) name = data.name;
        if (data.offers?.price) price = String(data.offers.price);
      } catch {}
    }

    if (!name) {
      const titleEl =
        document.querySelector('[data-v-39b21e06]') ||
        document.querySelector('h1') ||
        document.querySelector('[class*="product-title"]');
      if (titleEl) name = titleEl.textContent?.trim() || '';
    }

    if (!price) {
      const priceEl =
        document.querySelector('[data-v-39b21e06] .currency--currency') ||
        document.querySelector('[class*="product-price"]') ||
        document.querySelector('.product-briefing .price');
      if (priceEl) price = priceEl.textContent?.trim()?.replace(/[^0-9,.]/g, '') || '';
    }

    const img = document.querySelector('meta[property="og:image"]');
    const imageUrl = img?.getAttribute('content') || '';

    return { marketplace: 'shopee', url, name, price, imageUrl };
  }

  chrome.runtime.sendMessage({
    type: 'product-data',
    data: extractShopeeProduct(),
  });
})();
