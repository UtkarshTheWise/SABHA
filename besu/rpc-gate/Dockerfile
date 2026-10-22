# The public JSON-RPC gate. No dependencies, so there is nothing to install.
# node:24-alpine is a multi-arch image (amd64 and arm64).
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app
COPY gate.js server.js ./

USER node
EXPOSE 8080

# /healthz asks the validator for its block number, so it fails if either the
# gate or the node behind it is down.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "server.js"]
