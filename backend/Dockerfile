# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- production stage ----
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
# Alpine security fixes (e.g. OpenSSL) published after the base image was built.
RUN apk upgrade --no-cache
COPY package*.json ./
# npm, npx, yarn and corepack are only needed to install dependencies; the
# container runs plain `node`. Removing them keeps their bundled packages
# (and those packages' CVEs) out of the shipped image (Lab 07 Trivy gate).
RUN npm ci --omit=dev \
 && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=build /app/dist ./dist
RUN mkdir -p uploads/slips
EXPOSE 3000
CMD ["node", "dist/main.js"]
