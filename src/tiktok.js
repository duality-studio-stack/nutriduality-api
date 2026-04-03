const fetch = require('node-fetch');

/**
 * Extracts text content from a TikTok (or other social) URL.
 * Multiple strategies in order of reliability.
 */
async function extractTikTokContent(url) {
  const result = {
    title: '',
    description: '',
    authorName: '',
    videoUrl: url,
  };

  // Resolve short URLs (vm.tiktok.com, vt.tiktok.com)
  let resolvedUrl = url;
  if (url.includes('vm.tiktok.com') || url.includes('vt.tiktok.com')) {
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow', timeout: 8000 });
      resolvedUrl = res.url || url;
    } catch (_) {}
  }

  // Strategy 1: oEmbed (fast, always try first)
  try {
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(resolvedUrl)}`;
    const res = await fetch(oembedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'application/json',
      },
      timeout: 8000,
    });
    if (res.ok) {
      const data = await res.json();
      result.title = data.title || '';
      result.authorName = data.author_name || '';
    }
  } catch (e) {
    console.warn('[tiktok] oEmbed failed:', e.message);
  }

  // Strategy 2: HTML scrape with mobile user-agent + follow redirects
  try {
    const res = await fetch(resolvedUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 TikTok/26.2.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
      timeout: 12000,
    });

    if (res.ok) {
      const html = await res.text();

      // og:description
      const ogDescMatch =
        html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i) ||
        html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:description"/i);
      if (ogDescMatch) result.description = decodeHtmlEntities(ogDescMatch[1]);

      // og:title
      if (!result.title) {
        const ogTitleMatch =
          html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
          html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i);
        if (ogTitleMatch) result.title = decodeHtmlEntities(ogTitleMatch[1]);
      }

      // JSON-LD (richer data)
      const jsonLdMatches = html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
      for (const match of jsonLdMatches) {
        try {
          const jsonLd = JSON.parse(match[1]);
          if (jsonLd.description && jsonLd.description.length > result.description.length) {
            result.description = jsonLd.description;
          }
          if (jsonLd.name && !result.title) result.title = jsonLd.name;
        } catch (_) {}
      }

      // TikTok SIGI_STATE (Next.js hydration data — contains full caption)
      const sigiMatch = html.match(/window\['SIGI_STATE'\]\s*=\s*(\{[\s\S]*?\});\s*window\[/);
      if (sigiMatch) {
        try {
          const state = JSON.parse(sigiMatch[1]);
          const itemModule = state?.ItemModule;
          if (itemModule) {
            const firstItem = Object.values(itemModule)[0];
            if (firstItem?.desc && firstItem.desc.length > result.description.length) {
              result.description = firstItem.desc;
            }
          }
        } catch (_) {}
      }

      // __NEXT_DATA__ (another common pattern)
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
      if (nextDataMatch) {
        try {
          const nextData = JSON.parse(nextDataMatch[1]);
          const desc =
            nextData?.props?.pageProps?.itemInfo?.itemStruct?.desc ||
            nextData?.props?.pageProps?.videoData?.itemInfos?.text;
          if (desc && desc.length > result.description.length) {
            result.description = desc;
          }
        } catch (_) {}
      }
    }
  } catch (e) {
    console.warn('[tiktok] HTML fetch failed:', e.message);
  }

  console.log('[tiktok] Extracted:', {
    title: result.title?.slice(0, 80),
    descLength: result.description?.length,
    author: result.authorName,
  });

  return result;
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\\n/g, '\n')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

module.exports = { extractTikTokContent };
