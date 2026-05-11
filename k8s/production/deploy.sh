#!/bin/bash

##############################################################################
# Unified Kubernetes Deployment Script for Dots Application
# 
# Usage:
#   ./deploy.sh [--namespace NAMESPACE] [--google-client-id ID] [--anonymous-secret SECRET] [--tunnel-token TOKEN]
#
# Environment Variables (optional):
#   NAMESPACE               - K8s namespace (default: dots-production)
#   GOOGLE_CLIENT_ID        - Google OAuth client ID
#   ANONYMOUS_SECRET        - Secret for anonymous user authentication
#   TUNNEL_TOKEN            - Cloudflare tunnel token
#   FRONTEND_IMAGE          - Frontend image tag (default: docker.io/library/dots-frontend:latest)
#   BACKEND_IMAGE           - Backend image tag (default: docker.io/library/dots-backend:latest)
#   SKIP_CLOUDFLARED        - Set to true to skip cloudflared deployment
#   SKIP_INGRESS            - Set to true to skip ingress deployment
#
# Examples:
#   ./deploy.sh
#   ./deploy.sh --namespace dots-staging --google-client-id "xxx-xxx" --anonymous-secret "secret123"
#   FRONTEND_IMAGE=dots-frontend:v2.0 ./deploy.sh
##############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="${NAMESPACE:-dots-production}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-docker.io/library/dots-frontend:latest}"
BACKEND_IMAGE="${BACKEND_IMAGE:-docker.io/library/dots-backend:latest}"
SKIP_CLOUDFLARED="${SKIP_CLOUDFLARED:-false}"
SKIP_INGRESS="${SKIP_INGRESS:-false}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --namespace)
      NAMESPACE="$2"
      shift 2
      ;;
    --google-client-id)
      GOOGLE_CLIENT_ID="$2"
      shift 2
      ;;
    --anonymous-secret)
      ANONYMOUS_SECRET="$2"
      shift 2
      ;;
    --tunnel-token)
      TUNNEL_TOKEN="$2"
      shift 2
      ;;
    --frontend-image)
      FRONTEND_IMAGE="$2"
      shift 2
      ;;
    --backend-image)
      BACKEND_IMAGE="$2"
      shift 2
      ;;
    --skip-cloudflared)
      SKIP_CLOUDFLARED="true"
      shift
      ;;
    --skip-ingress)
      SKIP_INGRESS="true"
      shift
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

##############################################################################
# Helper Functions
##############################################################################

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_section() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

check_kubectl() {
  if ! command -v kubectl &> /dev/null; then
    log_error "kubectl is not installed or not in PATH"
    exit 1
  fi
  log_success "kubectl found: $(kubectl version --client --short)"
}

check_cluster() {
  if ! kubectl cluster-info &> /dev/null; then
    log_error "Cannot connect to Kubernetes cluster"
    exit 1
  fi
  log_success "Connected to Kubernetes cluster"
}

prompt_for_secret() {
  local var_name=$1
  local prompt_text=$2
  local current_value=${!var_name}
  
  if [ -z "$current_value" ]; then
    read -sp "${YELLOW}Enter ${prompt_text}:${NC} " current_value
    echo ""
    if [ -z "$current_value" ]; then
      log_error "${prompt_text} cannot be empty"
      return 1
    fi
  fi
  eval "${var_name}='${current_value}'"
  return 0
}

wait_for_deployment() {
  local deployment=$1
  local namespace=$2
  local timeout=${3:-300}
  local start_time=$(date +%s)
  
  log_info "Waiting for deployment ${deployment} to be ready (timeout: ${timeout}s)..."
  
  while true; do
    local current_time=$(date +%s)
    local elapsed=$((current_time - start_time))
    
    if [ $elapsed -gt $timeout ]; then
      log_error "Deployment ${deployment} failed to be ready within ${timeout}s"
      return 1
    fi
    
    local ready=$(kubectl get deployment "${deployment}" -n "${namespace}" -o jsonpath='{.status.conditions[?(@.type=="Available")].status}' 2>/dev/null || echo "False")
    if [ "$ready" = "True" ]; then
      log_success "Deployment ${deployment} is ready"
      return 0
    fi
    
    sleep 5
  done
}

check_endpoint() {
  local service=$1
  local namespace=$2
  local port=$3
  local path=${4:-/health}
  local protocol=${5:-http}
  
  log_info "Checking endpoint ${service}:${port}${path}..."
  
  local endpoint=$(kubectl get service "${service}" -n "${namespace}" -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
  if [ -z "$endpoint" ]; then
    log_warning "Could not get cluster IP for ${service}"
    return 0
  fi
  
  # Try to curl from a pod in the namespace
  local pod=$(kubectl get pod -n "${namespace}" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
  if [ -z "$pod" ]; then
    log_warning "No pods found in namespace to test endpoint"
    return 0
  fi
  
  if kubectl exec -n "${namespace}" "${pod}" -- curl -s "${protocol}://${endpoint}:${port}${path}" &>/dev/null; then
    log_success "Endpoint ${service}:${port} is responding"
    return 0
  else
    log_warning "Could not verify endpoint ${service}:${port} (pod may not have curl)"
    return 0
  fi
}

##############################################################################
# Main Deployment Flow
##############################################################################

main() {
  log_section "Dots Application Kubernetes Deployment"
  
  # Pre-flight checks
  log_section "Pre-flight Checks"
  check_kubectl
  check_cluster
  
  # Configuration
  log_section "Configuration"
  log_info "Namespace: ${NAMESPACE}"
  log_info "Frontend Image: ${FRONTEND_IMAGE}"
  log_info "Backend Image: ${BACKEND_IMAGE}"
  log_info "Skip Cloudflared: ${SKIP_CLOUDFLARED}"
  log_info "Skip Ingress: ${SKIP_INGRESS}"
  
  # Create namespace
  log_section "Step 1: Creating Namespace"
  if kubectl apply -f "${SCRIPT_DIR}/namespace.yaml" > /dev/null 2>&1; then
    log_success "Namespace created/updated"
  else
    log_error "Failed to create namespace"
    exit 1
  fi
  
  # Manage secrets
  log_section "Step 2: Managing Secrets"
  
  # Check if secrets already exist
  local secrets_exist=$(kubectl get secret dots-secrets -n "${NAMESPACE}" --ignore-not-found=true 2>/dev/null | wc -l)
  
  if [ $secrets_exist -eq 0 ]; then
    log_info "Secrets do not exist, will create them"
    
    # Prompt for secrets if not provided
    if ! prompt_for_secret "GOOGLE_CLIENT_ID" "Google Client ID"; then
      exit 1
    fi
    
    if ! prompt_for_secret "ANONYMOUS_SECRET" "Anonymous Secret"; then
      exit 1
    fi
    
    # Create dots-secrets
    kubectl create secret generic dots-secrets \
      --from-literal=GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID}" \
      --from-literal=ANONYMOUS_SECRET="${ANONYMOUS_SECRET}" \
      -n "${NAMESPACE}" \
      --dry-run=client -o yaml | kubectl apply -f - > /dev/null 2>&1
    
    log_success "Created dots-secrets"
  else
    log_info "dots-secrets already exist, skipping creation"
    
    # Optionally update if new values provided
    if [ -n "$GOOGLE_CLIENT_ID" ] || [ -n "$ANONYMOUS_SECRET" ]; then
      log_info "Updating existing secrets..."
      
      # Get current values if not provided
      if [ -z "$GOOGLE_CLIENT_ID" ]; then
        GOOGLE_CLIENT_ID=$(kubectl get secret dots-secrets -n "${NAMESPACE}" -o jsonpath='{.data.GOOGLE_CLIENT_ID}' | base64 -d)
      fi
      
      if [ -z "$ANONYMOUS_SECRET" ]; then
        ANONYMOUS_SECRET=$(kubectl get secret dots-secrets -n "${NAMESPACE}" -o jsonpath='{.data.ANONYMOUS_SECRET}' | base64 -d)
      fi
      
      kubectl delete secret dots-secrets -n "${NAMESPACE}" 2>/dev/null || true
      kubectl create secret generic dots-secrets \
        --from-literal=GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID}" \
        --from-literal=ANONYMOUS_SECRET="${ANONYMOUS_SECRET}" \
        -n "${NAMESPACE}" \
        --dry-run=client -o yaml | kubectl apply -f - > /dev/null 2>&1
      
      log_success "Updated dots-secrets"
    fi
  fi
  
  # Deploy Redis PersistentVolume
  log_section "Step 3: Deploying Redis PersistentVolume"
  if kubectl apply -f "${SCRIPT_DIR}/redis-pv.yaml" > /dev/null 2>&1; then
    log_success "Redis PersistentVolume created/updated"
  else
    log_warning "Failed to apply Redis PersistentVolume (may not be required)"
  fi
  
  # Deploy Redis
  log_section "Step 4: Deploying Redis"
  if kubectl apply -f "${SCRIPT_DIR}/redis.yaml" > /dev/null 2>&1; then
    log_success "Redis deployment created/updated"
    wait_for_deployment "redis" "${NAMESPACE}" 120
  else
    log_error "Failed to deploy Redis"
    exit 1
  fi
  
  # Deploy Backend
  log_section "Step 5: Deploying Backend"
  
  # Apply backend manifest (already has correct image)
  if kubectl apply -f "${SCRIPT_DIR}/backend.yaml" > /dev/null 2>&1; then
    log_success "Backend deployment created/updated"
    wait_for_deployment "dots-backend" "${NAMESPACE}" 120
  else
    log_error "Failed to deploy Backend"
    exit 1
  fi
  
  # Deploy Frontend
  log_section "Step 6: Deploying Frontend"
  
  # Create temporary frontend manifest with image substitution
  local temp_frontend=$(mktemp)
  sed "s|\${REGISTRY}/frontend:\${IMAGE_TAG}|${FRONTEND_IMAGE}|g" "${SCRIPT_DIR}/frontend.yaml" > "$temp_frontend"
  sed -i "s|imagePullPolicy.*||g" "$temp_frontend"  # Remove any existing imagePullPolicy
  
  # Ensure imagePullPolicy: Never for frontend
  sed -i "/name: frontend/a\\          imagePullPolicy: Never" "$temp_frontend"
  
  if kubectl apply -f "$temp_frontend" > /dev/null 2>&1; then
    log_success "Frontend deployment created/updated"
    wait_for_deployment "dots-frontend" "${NAMESPACE}" 120
  else
    log_error "Failed to deploy Frontend"
    rm -f "$temp_frontend"
    exit 1
  fi
  
  rm -f "$temp_frontend"
  
  # Add NodePort to Frontend Service if not present
  local frontend_type=$(kubectl get service dots-frontend -n "${NAMESPACE}" -o jsonpath='{.spec.type}' 2>/dev/null || echo "")
  if [ "$frontend_type" != "NodePort" ]; then
    log_info "Converting frontend service to NodePort..."
    kubectl patch service dots-frontend -n "${NAMESPACE}" -p '{"spec":{"type":"NodePort","ports":[{"port":80,"targetPort":80,"nodePort":30083}]}}' > /dev/null 2>&1
    log_success "Frontend service updated to NodePort 30083"
  fi
  
  # Deploy Cloudflared (optional)
  if [ "$SKIP_CLOUDFLARED" != "true" ]; then
    log_section "Step 7: Deploying Cloudflared Tunnel"
    
    local cloudflared_exists=$(kubectl get secret cloudflared-secrets -n "${NAMESPACE}" --ignore-not-found=true 2>/dev/null | wc -l)
    
    if [ $cloudflared_exists -eq 0 ]; then
      if prompt_for_secret "TUNNEL_TOKEN" "Cloudflare Tunnel Token"; then
        kubectl create secret generic cloudflared-secrets \
          --from-literal=TUNNEL_TOKEN="${TUNNEL_TOKEN}" \
          -n "${NAMESPACE}" \
          --dry-run=client -o yaml | kubectl apply -f - > /dev/null 2>&1
        
        log_success "Created cloudflared-secrets"
      else
        log_warning "Skipping Cloudflared deployment (no tunnel token provided)"
      fi
    else
      log_info "cloudflared-secrets already exist"
    fi
    
    if kubectl apply -f "${SCRIPT_DIR}/cloudflared.yaml" > /dev/null 2>&1; then
      log_success "Cloudflared deployment created/updated"
      wait_for_deployment "cloudflared" "${NAMESPACE}" 120
    else
      log_warning "Failed to deploy Cloudflared (optional component)"
    fi
  else
    log_section "Step 7: Skipping Cloudflared Tunnel (--skip-cloudflared)"
  fi
  
  # Deploy Ingress (optional)
  if [ "$SKIP_INGRESS" != "true" ]; then
    log_section "Step 8: Deploying Ingress"
    if kubectl apply -f "${SCRIPT_DIR}/ingress.yaml" > /dev/null 2>&1; then
      log_success "Ingress created/updated"
    else
      log_warning "Failed to deploy Ingress (optional component)"
    fi
  else
    log_section "Step 8: Skipping Ingress (--skip-ingress)"
  fi
  
  # Final Status Report
  log_section "Final Status Report"
  
  log_info "Deployments:"
  kubectl get deployments -n "${NAMESPACE}" -o wide
  
  echo ""
  log_info "Services:"
  kubectl get services -n "${NAMESPACE}" -o wide
  
  echo ""
  log_info "Pods:"
  kubectl get pods -n "${NAMESPACE}" -o wide
  
  echo ""
  log_section "Deployment Summary"
  
  local backend_ready=$(kubectl get deployment dots-backend -n "${NAMESPACE}" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  local frontend_ready=$(kubectl get deployment dots-frontend -n "${NAMESPACE}" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  local redis_ready=$(kubectl get deployment redis -n "${NAMESPACE}" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  
  log_info "Backend: ${backend_ready}/1 replicas ready"
  log_info "Frontend: ${frontend_ready}/2 replicas ready"
  log_info "Redis: ${redis_ready}/1 replicas ready"
  
  echo ""
  log_success "Deployment completed!"
  
  log_info "Access Points:"
  echo "  Backend:  http://192.168.1.6:30082/health"
  echo "  Frontend: http://192.168.1.6:30083/"
  echo "  Redis:    192.168.1.6:30379"
  
  echo ""
  log_info "To view logs:"
  echo "  kubectl logs -n ${NAMESPACE} -l app=dots-backend -f"
  echo "  kubectl logs -n ${NAMESPACE} -l app=dots-frontend -f"
}

# Run main function
main "$@"
