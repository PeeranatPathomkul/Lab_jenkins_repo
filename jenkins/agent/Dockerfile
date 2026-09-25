# Lab 01 — linux-build agent.
# Plain jenkins/inbound-agent has no Node, so `npm ci` in taskflow-smoke
# would fail; copy the Node 20 runtime in from the official image.
FROM node:20-bookworm-slim AS node

FROM jenkins/inbound-agent:latest-jdk21
USER root
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
USER jenkins
