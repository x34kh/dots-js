#!/bin/bash

# Script to inject Google Client ID into frontend build
# Usage: ./inject-config.sh <google_client_id>

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <google_client_id>"
    echo "Example: $0 123456789.apps.googleusercontent.com"
    exit 1
fi

GOOGLE_CLIENT_ID="$1"
CONFIG_FILE="frontend/public/config.js"

# Create public directory if it doesn't exist
mkdir -p frontend/public

# Create config.js
cat > "$CONFIG_FILE" << EOF
// Auto-generated configuration
// DO NOT EDIT MANUALLY
window.GAME_CONFIG = {
  googleClientId: '${GOOGLE_CLIENT_ID}'
};
EOF

echo "✓ Configuration written to $CONFIG_FILE"
echo "✓ Google Client ID: $GOOGLE_CLIENT_ID"
