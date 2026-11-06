# The read-only API (backend/src/server.js) as a container. No keys are baked in:
# ONECLICK_PARTNER_KEY and NEARAI_CLOUD_API_KEY come from the host's env at runtime.
FROM node:22-slim
ARG GIT_SHA=dev
ENV NODE_ENV=production PORT=10000 NEAR_RPC=https://free.rpc.fastnear.com GIT_SHA=$GIT_SHA
WORKDIR /srv
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY app/package.json app/
RUN npm ci --omit=dev -w backend && npm cache clean --force
COPY backend/src backend/src
COPY backend/data backend/data
COPY shared shared
# Backend modules import a few pure helpers from app/src (toll views, payouts plan, the
# board call signer, chronicle helpers). A hand-written COPY list drifted and the image
# failed to boot on a missing file, so build-image.mjs copies exactly what resolves.
COPY app/src/app-imports app/src
USER node
EXPOSE 10000
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/src/server.js"]
