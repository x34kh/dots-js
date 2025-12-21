# Backend Dockerfile - Fast deployment version
# Uses pre-built base image with dependencies installed

FROM ghcr.io/x34kh/dots-js-backend-base:latest

WORKDIR /app

# Copy application source code
COPY src ./src

# Expose port
EXPOSE 8080

# Start the server
CMD ["node", "src/index.js"]
