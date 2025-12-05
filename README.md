# Dots & Boxes - Neon Edition

A modern ThreeJS multiplayer game based on the classic "Dots and Boxes" with extended rules for diagonal connections and polygon territory capture.

## Features

- **ThreeJS Rendering**: High-contrast neon visuals with bloom effects, animated lines, and particle bursts
- **Extended Rules**: Supports orthogonal and diagonal connections, polygon territory detection
- **Multiple Game Modes**:
  - Demo Mode (P2P): WebRTC-based peer-to-peer gameplay
  - Anonymous Mode: Play online without login using secure cookie-based authentication
  - Online Mode: Google OAuth authenticated games with ELO ranking
- **Real-time Gameplay**: WebSocket-based server communication
- **ELO Rating System**: Competitive ranking with match history

## Quick Start

### Development

1. Install dependencies:
```bash
# Frontend
cd frontend
npm install

# Backend
cd backend
npm install
```

2. Start the development servers:
```bash
# Frontend (in frontend directory)
npm run dev

# Backend (in backend directory)
npm run dev
```

3. Open http://localhost:3000 in your browser

### Docker Deployment

```bash
# Build and run all services
docker-compose up --build

# Or run individual services
docker-compose up frontend
docker-compose up backend
```

## Game Rules

1. **Board**: 5x5 grid of dots
2. **Connections**: Players can draw lines between adjacent dots (horizontal, vertical, or diagonal)
3. **Territory Capture**: When a line closes a polygon, the enclosed area is captured
4. **Turn Continuation**: If a player captures territory, they continue playing
5. **Winning**: The player with the most captured territory wins

## Authentication Modes

### Anonymous Mode (Cookie-Based)
- No login required
- Secure HMAC-signed cookies prevent username spoofing
- Usernames are randomly generated (e.g., "SwiftFox123")
- Credentials persist for 30 days

### Google OAuth
- Full authentication for ranked games
- ELO rating tracking
- Match history

## API Documentation

See [API.md](./docs/API.md) for detailed API documentation.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  ThreeJS │  │  State   │  │   Auth   │  │ Network  │   │
│  │ Renderer │  │ Machine  │  │  Module  │  │  Layer   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            │                               │
            ▼                               ▼
    ┌───────────────┐               ┌───────────────┐
    │    WebRTC     │               │   WebSocket   │
    │  (P2P Mode)   │               │ (Online Mode) │
    └───────────────┘               └───────────────┘
                                            │
                                            ▼
┌─────────────────────────────────────────────────────────────┐
│                         Backend                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │   Auth   │  │   Game   │  │   ELO    │  │WebSocket │   │
│  │ Service  │  │ Manager  │  │ Service  │  │ Handler  │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │    Redis      │
                    │  (Optional)   │
                    └───────────────┘
```

## Technology Stack

- **Frontend**: Vanilla JavaScript, ThreeJS, Vite
- **Backend**: Node.js, Express, WebSocket (ws)
- **Authentication**: Google OAuth, HMAC-signed cookies
- **Real-time**: WebRTC (P2P), WebSocket (server)
- **Deployment**: Docker, Nginx, Kubernetes

## CI/CD & Deployment

The project uses GitHub Actions for continuous integration and deployment to a local Kubernetes cluster.

### Environments

| Environment | Domain | Branch |
|------------|--------|--------|
| Production | dots.nixsupport.net | main |
| Test | dots-test.nixsupport.net | all other branches |

### CI/CD Workflows

- **CI** (`ci.yml`): Runs on pull requests and pushes to main
  - Lints and tests both frontend and backend
  - Builds Docker images to verify they work

- **Deploy Production** (`deploy-production.yml`): Runs on pushes to main
  - Builds and pushes Docker images to GitHub Container Registry
  - Deploys to the production Kubernetes namespace

- **Deploy Test** (`deploy-test.yml`): Runs on pushes to non-main branches
  - Builds and pushes Docker images with test tags
  - Deploys to the test Kubernetes namespace

### Required GitHub Secrets

Configure these secrets in your repository settings:

| Secret | Description |
|--------|-------------|
| `REGISTRY_URL` | Container registry URL (e.g., `registry.example.com`) |
| `REGISTRY_USERNAME` | Registry username |
| `REGISTRY_PASSWORD` | Registry password or token |
| `REGISTRY_IMAGE_PREFIX` | Image prefix/path (e.g., `dots-js` or `myorg/dots-js`) |
| `KUBECONFIG` | Base64-encoded kubeconfig for cluster access |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `ANONYMOUS_SECRET` | Secret for anonymous cookie signing |

### Required Kubernetes Secrets

Create cloudflared secrets for tunnel access:

```bash
# Production
kubectl create secret generic cloudflared-secrets \
  --namespace dots-production \
  --from-literal=TUNNEL_TOKEN=<your-production-tunnel-token>

# Test
kubectl create secret generic cloudflared-secrets \
  --namespace dots-test \
  --from-literal=TUNNEL_TOKEN=<your-test-tunnel-token>
```

### Cloudflare Tunnel Setup

1. Create two tunnels in Cloudflare Zero Trust dashboard:
   - One for `dots.nixsupport.net` (production)
   - One for `dots-test.nixsupport.net` (test)

2. Configure each tunnel to route to the ingress controller in the respective namespace

3. Add the tunnel tokens as Kubernetes secrets (see above)

## License

MIT
