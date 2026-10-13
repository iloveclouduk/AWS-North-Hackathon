# AWS City server image. Build context = repo root (the server imports src/backend/contract.ts,
# src/world/* and src/console/risk.ts from the extension):
#   docker build -f server/Dockerfile -t aws-city-server .
# Base image pinned by digest (multi-arch index); Dependabot (.github/dependabot.yml) proposes updates.
FROM --platform=$BUILDPLATFORM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci
COPY src/backend/contract.ts src/backend/
COPY src/console/risk.ts src/console/types.ts src/console/
COPY src/world src/world
COPY shared shared
COPY server server
RUN cd server && npm run build:bundle

FROM node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
ENV NODE_ENV=production AWS_CITY_MODE=hosted HOST=0.0.0.0 PORT=8787 LOG_FORMAT=json
WORKDIR /app
COPY --from=build /app/server/dist ./dist
USER node
EXPOSE 8787
# No curl in the slim image: a tiny Node health probe for local `docker run` (ECS uses the ALB check).
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]
