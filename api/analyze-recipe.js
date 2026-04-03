import Groq from 'groq-sdk';

// ── CORS helper ───────────────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── TikTok scraper (runs on Vercel edge — phone fetch preferred) ──────────────
async function extractTikTokContent(url) {
  const result = { title: '', description: '', authorName: '', videoUrl: url };

  // oEmbed — fast, no scraping needed
  try {
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
    const res = await fetch(oembedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json();
      result.title = data.title || '';
      result.authorName = data.author_name || '';
    }
  } catch (_) {}

  // HTML scrape fallback
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const html = await res.text();

      const ogDesc = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i)
        || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:description"/i);
      if (ogDesc) result.description = ogDesc[1];

      if (!result.title) {
        const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)
          || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i);
        if (ogTitle) result.title = ogTitle[1];
      }

      // __NEXT_DATA__
      const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
      if (nd) {
        try {
          const d = JSON.parse(nd[1]);
          const cap = d?.props?.pageProps?.itemInfo?.itemStruct?.desc;
          if (cap && cap.length > result.description.length) result.description = cap;
        } catch (_) {}
      }
    }
  } catch (_) {}

  return result;
}

// ── Groq AI extraction ────────────────────────────────────────────────────────
async function extractRecipeWithAI(content) {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const text = [
    content.title ? `Titre: ${content.title}` : '',
    content.authorName ? `Auteur: ${content.authorName}` : '',
    content.description ? `Description: ${content.description}` : '',
  ].filter(Boolean).join('\n');

  if (!text.trim()) throw new Error('NO_CONTENT');

  const prompt = `Tu es un assistant spécialisé en extraction de recettes de cuisine.

Voici le contenu d'une vidéo :
---
${text}
---

Extrait la recette et réponds UNIQUEMENT avec un JSON valide, sans texte avant ou après :

{
  "name": "Nom de la recette",
  "category": "Petit-déjeuner|Déjeuner|Dîner|Collation|Dessert|Boisson|Autre",
  "ingredients": [{ "name": "ingrédient", "measure": "quantité" }],
  "instructions": "Étapes en français",
  "tags": ["tag1", "tag2"],
  "confidence": "high|medium|low"
}

Si le contenu est insuffisant, mets confidence "low" et fais de ton mieux. Réponds UNIQUEMENT avec le JSON.`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 1024,
  });

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) throw new Error('EMPTY_RESPONSE');

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('INVALID_JSON');

  const recipe = JSON.parse(jsonMatch[0]);
  if (!recipe.name || !recipe.ingredients) throw new Error('INCOMPLETE_RECIPE');

  return {
    name: recipe.name,
    category: recipe.category || 'Autre',
    ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
    instructions: recipe.instructions || '',
    tags: Array.isArray(recipe.tags) ? recipe.tags : [],
    confidence: recipe.confidence || 'medium',
    sourceUrl: content.videoUrl,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setCors(res);

  // Preflight
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, title, description } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  try {
    const content = {
      title: title || '',
      description: description || '',
      authorName: '',
      videoUrl: url,
    };

    // If app didn't send text, try server-side scrape as fallback
    if (!content.title && !content.description) {
      const scraped = await extractTikTokContent(url);
      content.title = scraped.title;
      content.description = scraped.description;
      content.authorName = scraped.authorName;
    }

    const recipe = await extractRecipeWithAI(content);
    return res.json({ success: true, recipe });

  } catch (err) {
    if (err.message === 'NO_CONTENT') {
      return res.status(422).json({ error: 'no_content', message: 'Contenu insuffisant pour extraire une recette.' });
    }
    if (err.message === 'INCOMPLETE_RECIPE') {
      return res.status(422).json({ error: 'incomplete_recipe', message: 'Cette vidéo ne semble pas contenir une recette.' });
    }
    console.error('[analyze-recipe]', err.message);
    return res.status(500).json({ error: 'server_error', message: 'Erreur serveur.' });
  }
}
