# syntax=docker/dockerfile:1
FROM node:18-alpine

WORKDIR /app

# Install dependencies using the committed lockfile
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Copy application code
COPY frontend/ ./

# Build for production (env vars injected at build time by the platform)
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_MAP_PROVIDER
ARG NEXT_PUBLIC_OSRM_URL
ARG NEXT_PUBLIC_NOMINATIM_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_MAP_PROVIDER=$NEXT_PUBLIC_MAP_PROVIDER
ENV NEXT_PUBLIC_OSRM_URL=$NEXT_PUBLIC_OSRM_URL
ENV NEXT_PUBLIC_NOMINATIM_URL=$NEXT_PUBLIC_NOMINATIM_URL

RUN npm run build

# Expose the port Render/Vercel injects
ENV PORT=3000
EXPOSE 3000

CMD npm start