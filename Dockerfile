# The read-only API (backend/src/server.js) as a container. No keys are baked in:
# ONECLICK_PARTNER_KEY and NEARAI_CLOUD_API_KEY come from the host's env at runtime.
FROM node:22-slim
ENV NODE_ENV=production PORT=10000 NEAR_RPC=https://free.rpc.fastnear.com
WORKDIR /srv
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY app/package.json app/
RUN npm ci --omit=dev -w backend && npm cache clean --force
COPY backend/src backend/src
COPY backend/data backend/data
COPY shared shared
USER node
EXPOSE 10000
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/src/server.js"]
