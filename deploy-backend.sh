#!/bin/bash
set -e

SERVER="192.168.1.251"
REGISTRY="localhost:32000"
IMAGE_TAG="$(date +%Y%m%d-%H%M%S)"

echo "Building and deploying backend..."

# Copy backend code to server
echo "Copying backend code..."
rsync -av --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  backend/ "${SERVER}:/tmp/dots-backend/"

# Build and push image on server
echo "Building Docker image on server..."
ssh "${SERVER}" << EOF
cd /tmp/dots-backend
docker build -t ${REGISTRY}/backend:${IMAGE_TAG} -f Dockerfile .
docker push ${REGISTRY}/backend:${IMAGE_TAG}
docker tag ${REGISTRY}/backend:${IMAGE_TAG} ${REGISTRY}/backend:latest
docker push ${REGISTRY}/backend:latest
EOF

# Update Kubernetes deployment
echo "Updating Kubernetes deployment..."
ssh "${SERVER}" << EOF
export REGISTRY=${REGISTRY}
export IMAGE_TAG=${IMAGE_TAG}
envsubst < /tmp/dots-backend/../k8s/production/backend.yaml | kubectl apply -f -
kubectl rollout restart deployment/dots-backend -n dots-production
EOF

echo "Deployment complete! Image: ${REGISTRY}/backend:${IMAGE_TAG}"
echo "Checking rollout status..."
ssh "${SERVER}" "kubectl rollout status deployment/dots-backend -n dots-production"
