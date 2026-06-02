# Stage 1 — build Angular frontend
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2 — serve with nginx
FROM nginx:alpine
RUN apk add --no-cache gettext

COPY --from=builder /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf.template /etc/nginx/nginx.conf.template
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
