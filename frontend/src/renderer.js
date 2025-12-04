/**
 * ThreeJS Game Renderer
 * Handles all visual rendering with neon effects
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export class GameRenderer {
  constructor(canvas, boardLogic) {
    this.canvas = canvas;
    this.boardLogic = boardLogic;
    this.dotMeshes = new Map(); // key: "x,y", value: mesh
    this.capturedAreaMeshes = [];
    this.previewMeshes = [];
    this.hoverDot = null;
    this.particles = [];
    
    // Animation state for smooth hover transitions
    this.dotAnimations = new Map(); // key: "x,y", value: { targetScale, targetEmissive, currentScale, currentEmissive }
    this.animationSpeed = 0.15; // Smooth transition speed
    
    this.playerColors = {
      1: new THREE.Color(0x00ffff), // Cyan
      2: new THREE.Color(0xff00ff)  // Magenta
    };
    
    this.defaultDotColor = new THREE.Color(0x4a4a6a);
    this.defaultEmissive = new THREE.Color(0x2a2a3a);
    this.capturedColor = new THREE.Color(0x1a1a2a);
    
    this.init();
  }

  init() {
    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a15);

    // Camera setup
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    const frustumSize = 8;
    this.camera = new THREE.OrthographicCamera(
      -frustumSize * aspect / 2,
      frustumSize * aspect / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      1000
    );
    this.camera.position.z = 10;

    // Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true
    });
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Post-processing for bloom effect
    this.composer = new EffectComposer(this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.canvas.clientWidth, this.canvas.clientHeight),
      0.8, // strength
      0.4, // radius
      0.85 // threshold
    );
    this.composer.addPass(bloomPass);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    this.scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0xffffff, 1, 50);
    pointLight.position.set(0, 0, 15);
    this.scene.add(pointLight);

    // Raycaster for mouse interaction
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Create board elements
    this.createBoard();

    // Handle resize
    window.addEventListener('resize', () => this.handleResize());
  }

  createBoard() {
    const gridSize = this.boardLogic.gridSize;
    const spacing = 1.5;
    const offset = (gridSize - 1) * spacing / 2;

    // Create grid background
    this.createGridBackground(gridSize, spacing, offset);

    // Create dots
    this.dotMeshes.clear();
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const dot = this.createDot(
          x * spacing - offset,
          y * spacing - offset,
          x,
          y
        );
        this.scene.add(dot);
        this.dotMeshes.set(`${x},${y}`, dot);
        
        // Initialize animation state
        this.dotAnimations.set(`${x},${y}`, {
          targetScale: 1,
          currentScale: 1,
          targetEmissiveIntensity: 0.5,
          currentEmissiveIntensity: 0.5,
          targetColor: this.defaultDotColor.clone()
        });
      }
    }
  }

  createGridBackground(gridSize, spacing, offset) {
    // Subtle grid lines
    const gridMaterial = new THREE.LineBasicMaterial({
      color: 0x1a1a2e,
      transparent: true,
      opacity: 0.5
    });

    const points = [];
    for (let i = 0; i < gridSize; i++) {
      const pos = i * spacing - offset;
      // Vertical lines
      points.push(new THREE.Vector3(pos, -offset - spacing, 0));
      points.push(new THREE.Vector3(pos, offset + spacing, 0));
      // Horizontal lines
      points.push(new THREE.Vector3(-offset - spacing, pos, 0));
      points.push(new THREE.Vector3(offset + spacing, pos, 0));
    }

    const gridGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const grid = new THREE.LineSegments(gridGeometry, gridMaterial);
    this.scene.add(grid);
  }

  createDot(x, y, gridX, gridY) {
    const geometry = new THREE.SphereGeometry(0.12, 32, 32);
    const material = new THREE.MeshStandardMaterial({
      color: 0x4a4a6a,
      emissive: 0x2a2a3a,
      emissiveIntensity: 0.5,
      metalness: 0.8,
      roughness: 0.2
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, 0);
    mesh.userData = { gridX, gridY, type: 'dot' };

    // Glow ring
    const ringGeometry = new THREE.RingGeometry(0.15, 0.2, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x4a4a6a,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.z = -0.01;
    mesh.add(ring);
    mesh.userData.ring = ring;

    return mesh;
  }

  /**
   * Mark a dot as owned by a player with animation
   */
  setDotOwner(x, y, playerNum) {
    const key = `${x},${y}`;
    const mesh = this.dotMeshes.get(key);
    const anim = this.dotAnimations.get(key);
    
    if (mesh && anim) {
      const color = this.playerColors[playerNum];
      anim.targetColor = color.clone();
      anim.targetEmissiveIntensity = 0.8;
      anim.targetScale = 1.2;
      mesh.userData.owner = playerNum;
      
      // Update ring
      if (mesh.userData.ring) {
        mesh.userData.ring.material.color.copy(color);
        mesh.userData.ring.material.opacity = 0.6;
      }
      
      // Check if this new dot is adjacent to any captured territory by this player
      // If so, update the territory fill to include the new boundary
      if (this.isDotAdjacentToCapturedTerritory(x, y, playerNum)) {
        this.updateCapturedAreaFills(playerNum);
      }
    }
  }

  /**
   * Check if a dot position is adjacent to captured territory for a player
   */
  isDotAdjacentToCapturedTerritory(x, y, playerNum) {
    const gridSize = this.boardLogic.gridSize;
    
    // Check all 8 neighbors
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize) {
          const dot = this.boardLogic.getDot(nx, ny);
          if (dot && dot.captured && dot.capturedBy === playerNum) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Remove captured area meshes for a specific player
   */
  removeCapturedAreaMeshesForPlayer(playerNum) {
    for (let i = this.capturedAreaMeshes.length - 1; i >= 0; i--) {
      const mesh = this.capturedAreaMeshes[i];
      if (mesh.userData && mesh.userData.playerNum === playerNum) {
        this.scene.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
        this.capturedAreaMeshes.splice(i, 1);
      }
    }
  }

  /**
   * Update all captured area fills for a player
   * Called when a new boundary dot is added that extends the territory
   */
  updateCapturedAreaFills(playerNum) {
    // Get all captured dots for this player
    const capturedDots = this.boardLogic.getCapturedDotsForPlayer(playerNum);
    
    if (capturedDots.length === 0) return;
    
    // Remove existing captured area meshes for this player
    this.removeCapturedAreaMeshesForPlayer(playerNum);
    
    // Create new captured area mesh with updated boundary
    this.createCapturedAreaMesh(capturedDots, playerNum);
  }

  /**
   * Mark dots as captured (enclosed) by a player
   */
  setCapturedDots(capturedDots, playerNum) {
    const color = this.playerColors[playerNum];
    
    for (const { x, y } of capturedDots) {
      const key = `${x},${y}`;
      const mesh = this.dotMeshes.get(key);
      const anim = this.dotAnimations.get(key);
      
      if (mesh && anim) {
        // Captured dots are dimmed and marked
        anim.targetColor = this.capturedColor.clone();
        anim.targetEmissiveIntensity = 0.2;
        anim.targetScale = 0.7;
        mesh.userData.captured = true;
        mesh.userData.capturedBy = playerNum;
        
        // Update ring to show capture
        if (mesh.userData.ring) {
          mesh.userData.ring.material.color.copy(color);
          mesh.userData.ring.material.opacity = 0.3;
        }
      }
    }
    
    // Create capture area visualization
    if (capturedDots.length > 0) {
      this.createCapturedAreaMesh(capturedDots, playerNum);
      this.createCaptureParticlesForDots(capturedDots, playerNum);
    }
  }

  /**
   * Create a mesh showing the captured area
   * Creates a polygon connecting the boundary dots and fills the enclosed space
   */
  createCapturedAreaMesh(capturedDots, playerNum) {
    const gridSize = this.boardLogic.gridSize;
    const spacing = 1.5;
    const offset = (gridSize - 1) * spacing / 2;
    const color = this.playerColors[playerNum];
    
    // Find boundary dots (owned dots adjacent to captured dots - including diagonals)
    const boundaryDots = new Set();
    for (const { x, y } of capturedDots) {
      // Check all 8 neighbors (orthogonal and diagonal)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize) {
            const dot = this.boardLogic.getDot(nx, ny);
            if (dot && dot.owner === playerNum) {
              boundaryDots.add(`${nx},${ny}`);
            }
          }
        }
      }
    }
    
    // Convert boundary dots to array of positions
    const boundaryPositions = Array.from(boundaryDots).map(key => {
      const [xStr, yStr] = key.split(',');
      return { x: parseInt(xStr), y: parseInt(yStr) };
    });
    
    // Sort boundary dots to form a proper polygon (angular sort around centroid)
    const sortedBoundary = this.sortPointsForPolygon(boundaryPositions);
    
    // Need at least 3 points to form a polygon
    if (sortedBoundary.length < 3) {
      return;
    }
    
    // Create a polygon shape connecting the boundary dots
    const shape = new THREE.Shape();
    
    // Convert grid coords to world coords
    const worldX = (gx) => gx * spacing - offset;
    const worldY = (gy) => gy * spacing - offset;
    
    // Move to first point
    shape.moveTo(worldX(sortedBoundary[0].x), worldY(sortedBoundary[0].y));
    
    // Draw lines to remaining points
    for (let i = 1; i < sortedBoundary.length; i++) {
      shape.lineTo(worldX(sortedBoundary[i].x), worldY(sortedBoundary[i].y));
    }
    
    // Close the shape
    shape.lineTo(worldX(sortedBoundary[0].x), worldY(sortedBoundary[0].y));
    
    const geometry = new THREE.ShapeGeometry(shape);
    const material = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = -0.15;
    mesh.userData = { targetOpacity: 0.15, playerNum: playerNum };
    
    this.scene.add(mesh);
    this.capturedAreaMeshes.push(mesh);
    
    // Animate opacity
    this.animateCapturedArea(mesh);
  }

  /**
   * Sort points to form a proper polygon (counter-clockwise order)
   * Uses angular sort around centroid
   */
  sortPointsForPolygon(points) {
    if (points.length < 3) return points;
    
    // Calculate centroid
    const centroid = {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length
    };
    
    // Sort by angle from centroid
    return points.sort((a, b) => {
      const angleA = Math.atan2(a.y - centroid.y, a.x - centroid.x);
      const angleB = Math.atan2(b.y - centroid.y, b.x - centroid.x);
      return angleA - angleB;
    });
  }

  /**
   * Animate captured area fade in
   */
  animateCapturedArea(mesh) {
    const animate = () => {
      if (mesh.material.opacity < mesh.userData.targetOpacity) {
        mesh.material.opacity += 0.02; // Faster increment for smoother animation
        requestAnimationFrame(animate);
      }
    };
    animate();
  }

  /**
   * Create particles for captured dots
   */
  createCaptureParticlesForDots(capturedDots, playerNum) {
    const gridSize = this.boardLogic.gridSize;
    const spacing = 1.5;
    const offset = (gridSize - 1) * spacing / 2;
    const color = this.playerColors[playerNum];

    for (const { x, y } of capturedDots) {
      const worldX = x * spacing - offset;
      const worldY = y * spacing - offset;
      
      // Create fewer particles per dot
      const particleCount = 10;
      for (let i = 0; i < particleCount; i++) {
        const geometry = new THREE.SphereGeometry(0.02 + Math.random() * 0.02, 6, 6);
        const material = new THREE.MeshBasicMaterial({
          color: color,
          transparent: true,
          opacity: 1
        });
        
        const particle = new THREE.Mesh(geometry, material);
        particle.position.set(worldX, worldY, 0.1);
        
        const angle = (i / particleCount) * Math.PI * 2;
        const speed = 0.3 + Math.random() * 0.3;
        particle.userData = {
          velocity: new THREE.Vector3(
            Math.cos(angle) * speed,
            Math.sin(angle) * speed,
            Math.random() * 0.3
          ),
          life: 1
        };
        
        this.scene.add(particle);
        this.particles.push(particle);
      }
    }
  }

  /**
   * Preview dots that would be captured
   */
  showCapturePreview(previewDots, playerNum) {
    this.clearPreviews();
    
    const gridSize = this.boardLogic.gridSize;
    const spacing = 1.5;
    const offset = (gridSize - 1) * spacing / 2;
    const color = this.playerColors[playerNum];
    
    for (const { x, y } of previewDots) {
      // Create preview ring around dot
      const ringGeometry = new THREE.RingGeometry(0.25, 0.35, 32);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide
      });
      
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.position.set(x * spacing - offset, y * spacing - offset, 0.02);
      
      this.scene.add(ring);
      this.previewMeshes.push(ring);
    }
  }

  clearPreviews() {
    this.previewMeshes.forEach(mesh => {
      this.scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    });
    this.previewMeshes = [];
  }

  /**
   * Set hover target for smooth animation
   */
  setDotHoverTarget(x, y, isHovered, playerNum = null) {
    const key = `${x},${y}`;
    const anim = this.dotAnimations.get(key);
    const mesh = this.dotMeshes.get(key);
    
    if (!anim || !mesh) return;
    
    // Don't animate owned or captured dots on hover
    if (mesh.userData.owner || mesh.userData.captured) return;
    
    if (isHovered && playerNum) {
      const color = this.playerColors[playerNum];
      anim.targetScale = 1.4;
      anim.targetEmissiveIntensity = 1.0;
      anim.targetColor = color.clone();
    } else {
      anim.targetScale = 1.0;
      anim.targetEmissiveIntensity = 0.5;
      anim.targetColor = this.defaultDotColor.clone();
    }
  }

  /**
   * Update all dot animations for smooth transitions
   */
  updateDotAnimations() {
    for (const [key, anim] of this.dotAnimations) {
      const mesh = this.dotMeshes.get(key);
      if (!mesh) continue;
      
      // Smooth scale transition
      const scaleDiff = anim.targetScale - anim.currentScale;
      if (Math.abs(scaleDiff) > 0.001) {
        anim.currentScale += scaleDiff * this.animationSpeed;
        mesh.scale.setScalar(anim.currentScale);
      }
      
      // Smooth emissive intensity transition
      const emissiveDiff = anim.targetEmissiveIntensity - anim.currentEmissiveIntensity;
      if (Math.abs(emissiveDiff) > 0.001) {
        anim.currentEmissiveIntensity += emissiveDiff * this.animationSpeed;
        mesh.material.emissiveIntensity = anim.currentEmissiveIntensity;
      }
      
      // Smooth color transition
      mesh.material.color.lerp(anim.targetColor, this.animationSpeed);
      mesh.material.emissive.lerp(anim.targetColor, this.animationSpeed);
      
      // Update ring if exists
      if (mesh.userData.ring) {
        mesh.userData.ring.material.color.lerp(anim.targetColor, this.animationSpeed);
      }
    }
  }

  updateParticles() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      
      particle.position.add(particle.userData.velocity);
      particle.userData.velocity.multiplyScalar(0.95);
      particle.userData.life -= 0.02;
      particle.material.opacity = particle.userData.life;
      
      if (particle.userData.life <= 0) {
        this.scene.remove(particle);
        particle.geometry.dispose();
        particle.material.dispose();
        this.particles.splice(i, 1);
      }
    }
  }

  getMousePosition(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  getDotAtMouse() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const dotArray = Array.from(this.dotMeshes.values());
    const intersects = this.raycaster.intersectObjects(dotArray);
    
    if (intersects.length > 0) {
      return intersects[0].object;
    }
    return null;
  }

  /**
   * Check if a dot mesh is clickable
   */
  isDotMeshClickable(mesh) {
    if (!mesh || !mesh.userData) return false;
    return !mesh.userData.owner && !mesh.userData.captured;
  }

  handleResize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const aspect = width / height;
    const frustumSize = 8;

    this.camera.left = -frustumSize * aspect / 2;
    this.camera.right = frustumSize * aspect / 2;
    this.camera.top = frustumSize / 2;
    this.camera.bottom = -frustumSize / 2;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
  }

  render() {
    this.updateParticles();
    this.updateDotAnimations();
    this.composer.render();
  }

  reset() {
    // Remove captured area meshes
    this.capturedAreaMeshes.forEach(mesh => {
      this.scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    });
    this.capturedAreaMeshes = [];

    // Clear previews
    this.clearPreviews();

    // Clear particles
    this.particles.forEach(p => this.scene.remove(p));
    this.particles = [];

    // Reset all dots to default state
    for (const [key, mesh] of this.dotMeshes) {
      mesh.userData.owner = null;
      mesh.userData.captured = false;
      mesh.userData.capturedBy = null;
      
      const anim = this.dotAnimations.get(key);
      if (anim) {
        anim.targetScale = 1.0;
        anim.currentScale = 1.0;
        anim.targetEmissiveIntensity = 0.5;
        anim.currentEmissiveIntensity = 0.5;
        anim.targetColor = this.defaultDotColor.clone();
      }
      
      mesh.scale.setScalar(1.0);
      mesh.material.color.copy(this.defaultDotColor);
      mesh.material.emissive.copy(this.defaultEmissive);
      mesh.material.emissiveIntensity = 0.5;
      
      if (mesh.userData.ring) {
        mesh.userData.ring.material.color.setHex(0x4a4a6a);
        mesh.userData.ring.material.opacity = 0.3;
      }
    }
    
    this.hoverDot = null;
  }
}
