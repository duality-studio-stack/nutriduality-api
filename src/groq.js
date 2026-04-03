const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Sends TikTok content to Groq/Llama and asks it to extract a structured recipe.
 * Returns a parsed recipe object or throws.
 */
async function extractRecipeWithAI(tiktokContent) {
  const { title, description, authorName, videoUrl } = tiktokContent;

  const textToAnalyze = [
    title ? `Titre: ${title}` : '',
    authorName ? `Auteur: ${authorName}` : '',
    description ? `Description: ${description}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  // Even with just a title, try to extract something
  if (!textToAnalyze.trim()) {
    throw new Error('NO_CONTENT');
  }

  console.log('[groq] Sending to AI:\n', textToAnalyze.slice(0, 300));

  const prompt = `Tu es un assistant spécialisé en extraction de recettes de cuisine.

Voici le contenu d'une vidéo TikTok :
---
${textToAnalyze}
---

Analyse ce contenu et extrait les informations de la recette. Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ou après, avec cette structure exacte :

{
  "name": "Nom de la recette",
  "category": "Une de ces catégories: Petit-déjeuner, Déjeuner, Dîner, Collation, Dessert, Boisson, Autre",
  "ingredients": [
    { "name": "nom ingrédient", "measure": "quantité" }
  ],
  "instructions": "Étapes de préparation détaillées",
  "tags": ["tag1", "tag2"],
  "confidence": "high|medium|low"
}

Règles :
- Si le contenu ne contient pas assez d'infos pour une recette, mets confidence: "low" et fais de ton mieux
- Les instructions doivent être en français
- Les tags doivent être utiles (ex: "rapide", "végétarien", "IG bas", "sans gluten")
- Si une quantité n'est pas mentionnée, mets "à goût" ou "selon recette"
- Réponds UNIQUEMENT avec le JSON, rien d'autre`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 1024,
  });

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) throw new Error('EMPTY_RESPONSE');

  // Extract JSON even if there's surrounding text
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('INVALID_JSON');

  const recipe = JSON.parse(jsonMatch[0]);

  // Validate minimum fields
  if (!recipe.name || !recipe.ingredients) {
    throw new Error('INCOMPLETE_RECIPE');
  }

  return {
    name: recipe.name || 'Recette TikTok',
    category: recipe.category || 'Autre',
    ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
    instructions: recipe.instructions || '',
    tags: Array.isArray(recipe.tags) ? recipe.tags : [],
    confidence: recipe.confidence || 'medium',
    sourceUrl: videoUrl,
  };
}

module.exports = { extractRecipeWithAI };
