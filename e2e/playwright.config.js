import { defineConfig } from '@playwright/test';
// BASE_URL: a deployed preview, or the local app (npm run build && node app/serve.mjs, backend on :8787).
export default defineConfig({
  testDir: '.', timeout: 90_000, retries: 1, workers: 2,
  // A run against the Vercel deploy is recorded separately from the local run.
  reporter: [['list'], ['json', { outputFile: `../judges/proofs/${/vercel\.app/.test(process.env.BASE_URL || '') ? 'e2e-vercel' : 'e2e-results'}.json` }]],
  use: { baseURL: process.env.BASE_URL || 'http://127.0.0.1:5173', screenshot: 'only-on-failure' },
});
