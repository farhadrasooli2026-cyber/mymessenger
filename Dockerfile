# syntax=docker/dockerfile:1
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NIXO_ENV=production
ENV NIXO_DEMO_INBOX=false
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=43151
RUN addgroup -S nixo && adduser -S nixo -G nixo
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./
USER nixo
EXPOSE 43151
HEALTHCHECK --interval=20s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- http://127.0.0.1:43151/api/health?probe=ready >/dev/null || exit 1
CMD ["npm", "run", "start"]
