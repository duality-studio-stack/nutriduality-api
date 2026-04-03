// Local dev server — mirrors the Vercel serverless functions
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import analyzeRecipeHandler from '../api/analyze-recipe.js';
import healthHandler from '../api/health.js';

const app = express();
app.use(cors());
app.use(express.json());

// Wrap Vercel-style handlers for Express
const wrap = (handler) => (req, res) => handler(req, res);

app.get('/health', wrap(healthHandler));
app.post('/analyze-recipe', wrap(analyzeRecipeHandler));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ NutriDuality backend running on port ${PORT}`);
  console.log(`   GROQ_API_KEY: ${process.env.GROQ_API_KEY ? '✓ configured' : '✗ MISSING'}`);
});
