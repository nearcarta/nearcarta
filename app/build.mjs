// Builds app/dist: console + live data interface + a copy of the design views.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
const here = new URL('.', import.meta.url).pathname;
const dist = here + 'dist';
rmSync(dist, { recursive: true, force: true }); mkdirSync(dist);
cpSync(here + 'src', dist, { recursive: true });
cpSync(here + 'design', dist + '/design', { recursive: true });
cpSync(here + 'design/D6_dashboards/src/data.js', dist + '/live/data.static.js');
// Static hosts serve files before rewrites, so put the live adapter at the path the
// interiors import. Only dist changes; app/design stays as delivered.
cpSync(here + 'src/live/data.js', dist + '/design/D6_dashboards/src/data.js');
const api = process.env.NEARCARTA_API || '';
writeFileSync(dist + '/config.js', `window.NEARCARTA_API=${JSON.stringify(api)};globalThis.NEARCARTA_API=window.NEARCARTA_API;\n`);
console.log('built app/dist with API', api || '(same origin)');
