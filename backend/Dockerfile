# Backend Dockerfile

FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install --production

# Copy application source code
COPY src ./src

# Expose port
EXPOSE 8080

# Start the server
CMD ["node", "src/index.js"]
