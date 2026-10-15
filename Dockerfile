# syntax=docker/dockerfile:1
#
# Image of the CAP server, built for the production profile (SAP HANA, XSUAA).
#
#   docker build -t customer-messages .
#   docker run --rm -p 4004:4004 <environment> customer-messages
#
# Two stages. "build" installs all dependencies and runs "npm run build" (cds build --production).
# "runtime" only holds the result, gen/srv with its production dependencies, and runs as the user
# "node". No configuration or secret is part of the image: pass the service bindings of the database,
# XSUAA and the destination, and the AI Core binding, as environment variables or service bindings
# when the container starts (see "Run in a container" in the README).

ARG NODE_VERSION=22

# ---- build -------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app

# The dependencies first: this layer is reused as long as the package files do not change.
COPY package.json package-lock.json ./
RUN npm ci

# What "cds build" compiles: the model (db), the services (srv) and the UI annotations (app).
COPY db ./db
COPY srv ./srv
COPY app ./app
RUN npm run build

# gen/srv/package.json lists what the server needs at runtime, without the development tools.
RUN cd gen/srv && npm ci --omit=dev

# ---- runtime -----------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
LABEL org.opencontainers.image.title="Customer Messages" \
      org.opencontainers.image.description="CAP server of the Customer Messages application" \
      org.opencontainers.image.source="https://github.com/brunofbenicio/SapCapWorkShop"

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/gen/srv ./

# Not root: the files are readable by the user node, and the server does not write into the folder.
USER node
EXPOSE 4004

# The health check of srv/server.js is public and also tells whether the database is reachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-4004}/health" || exit 1

# cds-serve is the server of "npm start". It is started directly, not through npm, so that it is the
# process that receives SIGTERM and shuts down gracefully.
CMD ["node_modules/.bin/cds-serve"]
