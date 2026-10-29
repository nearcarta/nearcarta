import { serve } from '@hono/node-server';
import { makeApp, warm } from './app.js';
import { cfg } from './config.js';

serve({ fetch: makeApp().fetch, port: cfg.port, hostname: '0.0.0.0' }, i => console.log(`nearcarta api on :${i.port}`));
if (process.env.NO_WARM !== '1') warm();
// background settler for toll visits (only when TOLL_SETTLER_KEY/ACCOUNT are set; its key may only call gate.settle)
import('./tollgate.js').then(t => t.startSettler()).catch(() => {});
// self-ping so the free instance does not spin down before Nov 25 (needs RENDER_EXTERNAL_URL, set by Render)
import('./keepwarm.js').then(k => k.startKeepWarm()).catch(() => {});
