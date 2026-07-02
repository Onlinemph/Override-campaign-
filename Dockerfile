# OVERRIDE GM Tool — single-container deployment.
#
#   docker build -t override-gm .
#   docker run -p 8420:8420 -v override-data:/data \
#     -e OVERRIDE_GM_KEY=change-me override-gm
#
# The campaign log persists in the /data volume (survives restarts & redeploys).
# All library data is vendored in the repo — the build needs no network beyond npm.
FROM node:22-alpine
WORKDIR /app

COPY . .
RUN npm ci && npm run build:battle

ENV NODE_ENV=production \
    PORT=8420 \
    OVERRIDE_LOG=/data/war.jsonl
# OVERRIDE_GM_KEY   — set at run time; gates /gm, /editor, /audit (do NOT skip this online)
# OVERRIDE_CAMPAIGN — optional path to a campaign json (defaults to demo/campaign.json)

VOLUME /data
EXPOSE 8420
CMD ["npx", "tsx", "src/server/index.ts"]
