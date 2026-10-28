// Vercel function: the same read-only Hono API as backend/src/server.js (no route signs).
import { makeApp } from '../backend/src/app.js';
const app = makeApp();
const handle = req => app.fetch(req);
export const GET = handle, POST = handle, OPTIONS = handle;
