(function () {
  'use strict';

  function extractAmazonProduct() {
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
      const titleEl = document.querySelector('#productTitle') || document.querySelector('h1');
      if (titleEl) name = titleEl.textContent?.trim() || '';
    }

    if (!price) {
      const priceEl =
        document.querySelector('.a-price .a-offscreen') ||
        document.querySelector('#priceblock_ourprice') ||
        document.querySelector('#corePrice_desktop .a-price .a-offscreen');
      if (priceEl) price = priceEl.textContent?.trim()?.replace(/[^0-9,.]/g, '') || '';
    }

    const img = document.querySelector('meta[property="og:image"]');
    const imageUrl = img?.getAttribute('content') || '';

    return { marketplace: 'amazon', url, name, price, imageUrl };
  }

  chrome.runtime.sendMessage({
    type: 'product-data',
    data: extractAmazonProduct(),
  });
})();
