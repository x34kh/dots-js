# Initial Setup for Docker Base Images

## IMPORTANT: First-Time Setup Required

Before the optimized deployment can work, base images must be built and pushed to the registry.

## Step 1: Build Base Images

You need to manually trigger the base image build workflow **once**:

### Option A: Via GitHub Actions UI
1. Go to: https://github.com/x34kh/dots-js/actions
2. Click on "Build Base Images" workflow
3. Click "Run workflow" button
4. Select "main" branch
5. Click "Run workflow"
6. Wait for completion (~2-3 minutes)

### Option B: Via GitHub CLI
```bash
gh workflow run build-base-images.yml
```

### Option C: Via curl (requires GitHub token)
```bash
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/x34kh/dots-js/actions/workflows/build-base-images.yml/dispatches \
  -d '{"ref":"main"}'
```

## Step 2: Verify Base Images

After the workflow completes, verify the images exist:

```bash
# On your deployment server
docker pull ghcr.io/x34kh/dots-js-frontend-base:latest
docker pull ghcr.io/x34kh/dots-js-backend-base:latest
```

## Step 3: Deploy as Normal

Once base images exist, regular CI/CD will work:
1. Push code to main
2. CI builds frontend and Docker images
3. Deploy workflow updates Kubernetes
4. Deployment completes in ~10 seconds

## What Happens if Base Images Don't Exist?

The deployment will **fail** with an error like:
```
Error response from daemon: manifest for ghcr.io/x34kh/dots-js-frontend-base:latest not found
```

**Solution:** Run the base image build workflow (Step 1)

## When to Rebuild Base Images

Base images automatically rebuild when:
- `package.json` or `package-lock.json` changes
- `Dockerfile.base` files change

You can also manually trigger rebuilds anytime dependencies need updating.

## Troubleshooting

### Q: CI is failing with "base image not found"
**A:** Base images haven't been built yet. Run the build-base-images workflow.

### Q: Do I need to rebuild base images every deployment?
**A:** No! Only when dependencies change. That's the whole point of the optimization.

### Q: How do I revert to the old build process?
**A:** See the "Fallback Strategy" section in docs/DOCKER_BASE_IMAGES.md

### Q: Can I use a local registry for base images?
**A:** Yes, update the image names in Dockerfile to point to your registry:
```dockerfile
FROM your-registry.com/dots-js-frontend-base:latest
```

## Registry Authentication

If using GitHub Container Registry (ghcr.io), ensure:
1. The repository has packages write permission
2. Workflows have `packages: write` permission
3. The `GITHUB_TOKEN` is properly configured

For private registries, add authentication:
```yaml
- name: Log in to registry
  uses: docker/login-action@v3
  with:
    registry: your-registry.com
    username: ${{ secrets.REGISTRY_USER }}
    password: ${{ secrets.REGISTRY_PASSWORD }}
```
