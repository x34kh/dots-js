# Docker Base Images

This directory contains optimized Dockerfiles that use pre-built base images to speed up deployment.

## Architecture

### Base Images
Base images contain all npm dependencies pre-installed but no application code:
- `ghcr.io/x34kh/dots-js-frontend-base:latest` - Frontend dependencies
- `ghcr.io/x34kh/dots-js-backend-base:latest` - Backend dependencies

### Application Images
Application images extend base images and only copy application code:
- `frontend/Dockerfile` - Copies pre-built `dist/` folder
- `backend/Dockerfile` - Copies `src/` folder

## Benefits

**Fast Deployment:**
- No npm install during deployment (saves 30-60 seconds)
- No frontend build during deployment (saves 20-30 seconds)
- Docker layers are smaller and cache better

**CI/CD Flow:**
1. CI builds frontend locally: `npm ci && npm run build`
2. Docker build just copies `dist/` folder
3. Total build time: ~10 seconds (vs ~90 seconds before)

## Building Base Images

Base images only need to be rebuilt when dependencies change:

### Manual Build
```bash
# Frontend base
cd frontend
docker build -f Dockerfile.base -t ghcr.io/x34kh/dots-js-frontend-base:latest .
docker push ghcr.io/x34kh/dots-js-frontend-base:latest

# Backend base
cd backend
docker build -f Dockerfile.base -t ghcr.io/x34kh/dots-js-backend-base:latest .
docker push ghcr.io/x34kh/dots-js-backend-base:latest
```

### Automated Build
Base images are automatically rebuilt by the `build-base-images.yml` workflow when:
- `package.json` or `package-lock.json` changes
- `Dockerfile.base` files change
- Manually triggered via GitHub Actions

## Local Development

For local Docker builds, you need the base images:

```bash
# Pull base images
docker pull ghcr.io/x34kh/dots-js-frontend-base:latest
docker pull ghcr.io/x34kh/dots-js-backend-base:latest

# Build frontend (after running npm run build)
cd frontend
npm run build
docker build -t dots-frontend .

# Build backend
cd backend
docker build -t dots-backend .
```

## Fallback Strategy

If base images are not available, you can temporarily revert to the full build Dockerfiles:

```dockerfile
# Frontend - Full build version
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

## Maintenance

**When to rebuild base images:**
- After updating dependencies (`npm install <package>`)
- After major version updates
- After changing build tools (Vite, webpack, etc.)

**Recommended schedule:**
- Check weekly for security updates
- Rebuild monthly as maintenance
- Rebuild immediately after dependency changes
