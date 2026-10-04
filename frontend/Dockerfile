# Module 25 — production image: install -> build -> run, as a non-root user.
#
# GOTCHA (documented in docs/deploy.md): NEXT_PUBLIC_* values are INLINED into
# the JS bundle at BUILD time, not read at runtime. NEXT_PUBLIC_API_URL must
# therefore be passed as a build ARG below — setting it only in the container's
# environment at `docker run` time will NOT change the compiled app.
#
# There is no public/ directory in this project, so nothing static is copied.
# There is no package-lock.json either, so `npm ci` is attempted first and we
# fall back to `npm install`; commit the lockfile for reproducible builds.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm ci || npm install

FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build runs `tsc`, so a type error fails the image build on purpose.
ARG NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.js ./next.config.js
USER nextjs
EXPOSE 3000
CMD ["npm", "run", "start", "--", "-p", "3000"]
