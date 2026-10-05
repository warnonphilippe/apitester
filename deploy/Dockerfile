# Stage 1 — build Angular frontend
FROM node:22-alpine AS builder
WORKDIR /app
# Electron (devDependency de l'app de bureau) est inutile pour l'image web.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2 — serve with nginx
FROM nginx:alpine
RUN apk add --no-cache jq

COPY --from=builder /app/dist /usr/share/nginx/html
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
