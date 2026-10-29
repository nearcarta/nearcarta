import { serve } from '@hono/node-server';
import { makeApp, warm } from './app.js';
import { cfg } from './config.js';

serve({ fetch: makeApp().fetch, port: cfg.port, hostname: '0.0.0.0' }, i => console.log(`nearcarta api on :${i.port}`));
if (process.env.NO_WARM !== '1') warm();
