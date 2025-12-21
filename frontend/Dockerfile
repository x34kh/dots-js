# Frontend Dockerfile - Fast deployment version
# Assumes code is already built locally and base image exists

# Use pre-built base image with dependencies
FROM ghcr.io/x34kh/dots-js-frontend-base:latest AS base

WORKDIR /app

# Copy pre-built dist folder
COPY dist ./dist

# Production stage
FROM nginx:alpine

# Copy built files
COPY --from=base /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
