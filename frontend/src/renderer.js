/**
 * ThreeJS Game Renderer
 * Handles all visual rendering with neon effects
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { skinManager } from './skins.js';

export class GameRenderer {
  // Board layout constants
  static DOT_SPACING = 1.5;
  static BASE_FRUSTUM_SIZE = 8;
  static BOARD_PADDING = 1.5;
  static LARGE_BOARD_THRESHOLD = 5; // Boards larger than this use minimum zoom
  static ZOOM_SPEED = 0.1;
  static NEIGHBOR_ADJACENCY_DISTANCE = 2; // Maximum distance to consider neighbors adjacent
  
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
    
    // Pulsing animation for pending moves
    this.pulsingDot = null; // key: "x,y"
    this.pulseTime = 0;
    
    // Use skin manager for player colors
    this.playerColors = skinManager.getPlayerColors();
    
    this.defaultDotColor = new THREE.Color(0x4a4a6a);
    this.defaultEmissive = new THREE.Color(0x2a2a3a);
    this.capturedColor = new THREE.Color(0x1a1a2a);
    
    // Zoom and pan state
    this.zoomLevel = 1.0;
    this.minZoom = 0.5; // Will be calculated in createBoard based on grid size
    this.maxZoom = 3.0;
    this.panOffset = new THREE.Vector2(0, 0);
    this.isPanning = false;
    this.panStart = new THREE.Vector2();
    this.panStartOffset = new THREE.Vector2();
    
    // Pinch zoom state
    this.isPinching = false;
    this.lastPinchDistance = 0;
    this.pinchCenter = new THREE.Vector2();
    
    // Dot selection tolerance (in world units)
    this.dotSelectionTolerance = 0.3;
    
    this.init();
  }

  /**
   * Update colors from the current skin
   */
  updateSkinColors() {
    this.playerColors = skinManager.getPlayerColors();
    
    // Update all owned dots to use new colors/textures
    for (const [key, mesh] of this.dotMeshes) {
      const owner = mesh.userData.owner;
      if (owner) {
        const color = this.playerColors[owner];
        const anim = this.dotAnimations.get(key);
        
        if (anim) {
          anim.targetColor = color.clone();
        }
        
        // Apply pattern texture if available
        const patternTexture = skinManager.getPatternTexture(owner);
        if (patternTexture) {
          mesh.material.map = patternTexture;
          mesh.material.color.setHex(0xffffff);
          mesh.material.needsUpdate = true;
        } else {
          mesh.material.map = null;
          mesh.material.color.copy(color);
          mesh.material.needsUpdate = true;
        }
        
        // Update ring
        if (mesh.userData.ring) {
          mesh.userData.ring.material.color.copy(color);
        }
      }
    }
    
    // Update captured area fills
    for (let i = 1; i <= 2; i++) {
      this.updateCapturedAreaFills(i);
    }
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
    
    // Set up zoom and pan event handlers
    this.setupZoomPanControls();
  }
  
  /**
   * Set up mouse wheel zoom and pan controls
   */
  setupZoomPanControls() {
    // Mouse wheel zoom
    this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
    
    // Pan controls - mouse down, move, up
    this.canvas.addEventListener('mousedown', (e) => this.handlePanStart(e));
    this.canvas.addEventListener('mousemove', (e) => this.handlePanMove(e));
    this.canvas.addEventListener('mouseup', () => this.handlePanEnd());
    this.canvas.addEventListener('mouseleave', () => this.handlePanEnd());
    
    // Touch pan controls for mobile
    this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
    this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
    this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: false });
  }
  
  /**
   * Handle mouse wheel for zoom
   */
  handleWheel(event) {
    event.preventDefault();
    
    const delta = event.deltaY > 0 ? -GameRenderer.ZOOM_SPEED : GameRenderer.ZOOM_SPEED;
    
    const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoomLevel + delta));
    
    if (newZoom !== this.zoomLevel) {
      this.zoomLevel = newZoom;
      this.updateCameraZoom();
    }
  }
  
  /**
   * Handle pan start on mouse down
   */
  handlePanStart(event) {
    // Only pan with left mouse button
    if (event.button !== 0) return;
    
    // Check if clicking on a dot - if so, don't start panning
    this.getMousePosition(event);
    const dot = this.getDotAtMouse();
    
    if (dot && this.isDotMeshClickable(dot)) {
      // User is clicking on a dot, don't pan
      return;
    }
    
    this.isPanning = true;
    this.panStart.set(event.clientX, event.clientY);
    this.panStartOffset.copy(this.panOffset);
    this.canvas.style.cursor = 'grabbing';
  }
  
  /**
   * Handle pan movement
   */
  handlePanMove(event) {
    if (!this.isPanning) return;
    
    const rect = this.canvas.getBoundingClientRect();
    const aspect = rect.width / rect.height;
    const frustumSize = GameRenderer.BASE_FRUSTUM_SIZE / this.zoomLevel;
    
    // Calculate pan delta in world coordinates
    const dx = (event.clientX - this.panStart.x) / rect.width * frustumSize * aspect;
    const dy = -(event.clientY - this.panStart.y) / rect.height * frustumSize;
    
    this.panOffset.set(
      this.panStartOffset.x + dx,
      this.panStartOffset.y + dy
    );
    
    this.updateCameraPosition();
  }
  
  /**
   * Handle pan end
   */
  handlePanEnd() {
    if (this.isPanning) {
      this.isPanning = false;
      this.canvas.style.cursor = 'default';
    }
  }
  
  /**
   * Handle touch start - support both pan and pinch zoom
   */
  handleTouchStart(event) {
    if (event.touches.length === 1) {
      // Single touch - check for dot or start panning
      const touch = event.touches[0];
      this.getMousePosition({ clientX: touch.clientX, clientY: touch.clientY });
      const dot = this.getNearestDot();
      
      if (!dot || !this.isDotMeshClickable(dot)) {
        event.preventDefault();
        this.isPanning = true;
        this.panStart.set(touch.clientX, touch.clientY);
        this.panStartOffset.copy(this.panOffset);
      }
    } else if (event.touches.length === 2) {
      // Two touches - start pinch zoom
      event.preventDefault();
      this.isPinching = true;
      this.isPanning = false;
      
      const touch1 = event.touches[0];
      const touch2 = event.touches[1];
      
      this.lastPinchDistance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      
      // Store center point for zoom focus
      this.pinchCenter.set(
        (touch1.clientX + touch2.clientX) / 2,
        (touch1.clientY + touch2.clientY) / 2
      );
    }
  }
  
  /**
   * Handle touch move - pan or pinch zoom
   */
  handleTouchMove(event) {
    if (event.touches.length === 1 && this.isPanning) {
      // Single touch panning
      event.preventDefault();
      const touch = event.touches[0];
      
      const rect = this.canvas.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      const frustumSize = GameRenderer.BASE_FRUSTUM_SIZE / this.zoomLevel;
      
      const dx = (touch.clientX - this.panStart.x) / rect.width * frustumSize * aspect;
      const dy = -(touch.clientY - this.panStart.y) / rect.height * frustumSize;
      
      this.panOffset.set(
        this.panStartOffset.x + dx,
        this.panStartOffset.y + dy
      );
      
      this.updateCameraPosition();
    } else if (event.touches.length === 2 && this.isPinching) {
      // Pinch zoom
      event.preventDefault();
      
      const touch1 = event.touches[0];
      const touch2 = event.touches[1];
      
      const currentDistance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      
      // Calculate zoom delta
      const pinchDelta = currentDistance - this.lastPinchDistance;
      const zoomDelta = pinchDelta * 0.01; // Sensitivity factor
      
      const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoomLevel + zoomDelta));
      
      if (newZoom !== this.zoomLevel) {
        this.zoomLevel = newZoom;
        this.updateCameraZoom();
      }
      
      this.lastPinchDistance = currentDistance;
    }
  }
  
  /**
   * Handle touch end
   */
  handleTouchEnd(event) {
    if (event.touches.length < 2) {
      this.isPinching = false;
    }
    if (event.touches.length === 0) {
      this.handlePanEnd();
    }
  }
  
  /**
   * Update camera zoom level
   */
  updateCameraZoom() {
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    const frustumSize = GameRenderer.BASE_FRUSTUM_SIZE / this.zoomLevel;
    
    this.camera.left = -frustumSize * aspect / 2;
    this.camera.right = frustumSize * aspect / 2;
    this.camera.top = frustumSize / 2;
    this.camera.bottom = -frustumSize / 2;
    this.camera.updateProjectionMatrix();
  }
  
  /**
   * Update camera position for panning
   */
  updateCameraPosition() {
    this.camera.position.x = -this.panOffset.x;
    this.camera.position.y = -this.panOffset.y;
    this.camera.updateProjectionMatrix();
  }
  
  /**
   * Calculate minimum zoom level to fit all dots in view
   */
  calculateMinZoom() {
    const gridSize = this.boardLogic.gridSize;
    const boardSize = (gridSize - 1) * GameRenderer.DOT_SPACING;
    
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    
    // Calculate the zoom level needed to fit the entire board
    // We need the board + some padding to fit in the frustum
    const requiredWidth = boardSize + GameRenderer.BOARD_PADDING * 2;
    const requiredHeight = boardSize + GameRenderer.BOARD_PADDING * 2;
    
    // Calculate zoom needed for both dimensions
    const zoomForWidth = (GameRenderer.BASE_FRUSTUM_SIZE * aspect) / requiredWidth;
    const zoomForHeight = GameRenderer.BASE_FRUSTUM_SIZE / requiredHeight;
    
    // Use the smaller zoom to ensure both dimensions fit
    return Math.min(zoomForWidth, zoomForHeight, 1.0);
  }
  
  /**
   * Reset zoom and pan to default
   */
  resetZoomPan() {
    // For large boards, reset to minimum zoom to show entire board
    const gridSize = this.boardLogic.gridSize;
    if (gridSize > GameRenderer.LARGE_BOARD_THRESHOLD) {
      this.zoomLevel = this.minZoom;
    } else {
      this.zoomLevel = 1.0;
    }
    this.panOffset.set(0, 0);
    this.updateCameraZoom();
    this.updateCameraPosition();
  }

  createBoard() {
    const gridSize = this.boardLogic.gridSize;
    const spacing = GameRenderer.DOT_SPACING;
    const offset = (gridSize - 1) * spacing / 2;

    // Calculate and set minimum zoom level based on grid size
    this.minZoom = this.calculateMinZoom();
    
    // For large boards, start at minimum zoom to show entire board
    if (gridSize > GameRenderer.LARGE_BOARD_THRESHOLD) {
      this.zoomLevel = this.minZoom;
      this.updateCameraZoom();
    }
    
    // Reset pan offset
    this.panOffset.set(0, 0);
    this.updateCameraPosition();

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
      
      // Apply pattern texture if available
      const patternTexture = skinManager.getPatternTexture(playerNum);
      if (patternTexture) {
        mesh.material.map = patternTexture;
        mesh.material.color.setHex(0xffffff); // Use white so texture shows its true colors
        mesh.material.needsUpdate = true;
      } else {
        mesh.material.map = null;
        mesh.material.color.copy(color);
        mesh.material.needsUpdate = true;
      }
      
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
   * Uses cell-based approach to fill each captured cell for accurate complex shapes
   * Supports pattern textures based on the current skin
   */
  createCapturedAreaMesh(capturedDots, playerNum) {
    const gridSize = this.boardLogic.gridSize;
    const spacing = GameRenderer.DOT_SPACING;
    const offset = (gridSize - 1) * spacing / 2;
    const color = this.playerColors[playerNum];
    
    if (capturedDots.length === 0) return;
    
    // Convert grid coords to world coords
    const worldX = (gx) => gx * spacing - offset;
    const worldY = (gy) => gy * spacing - offset;
    
    // Create a set for quick lookup of captured dots
    const capturedSet = new Set(capturedDots.map(d => `${d.x},${d.y}`));
    
    // Find all boundary dots (owned dots adjacent to captured dots)
    const boundaryDots = new Set();
    for (const { x, y } of capturedDots) {
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
    
    // Get all relevant points (captured dots + boundary dots)
    const allPoints = new Set([...capturedSet, ...boundaryDots]);
    
    const vertices = [];
    const indices = [];
    const vertexMap = new Map();
    const edgeSet = new Set(); // Track which edges have been used in complete cells
    
    // Build vertices array
    for (const key of allPoints) {
      const [xStr, yStr] = key.split(',');
      const x = parseInt(xStr);
      const y = parseInt(yStr);
      vertexMap.set(key, vertices.length / 3);
      vertices.push(worldX(x), worldY(y), 0);
    }
    
    // Helper to mark edges as used in cells
    const markCellEdges = (c0, c1, c2, c3) => {
      const edges = [
        [c0, c1].sort((a, b) => a - b).join(','),
        [c1, c2].sort((a, b) => a - b).join(','),
        [c2, c3].sort((a, b) => a - b).join(','),
        [c3, c0].sort((a, b) => a - b).join(','),
        [c0, c2].sort((a, b) => a - b).join(',')  // diagonal
      ];
      edges.forEach(e => edgeSet.add(e));
    };
    
    // Find bounding box and process complete rectangular cells first
    let minX = gridSize, maxX = -1, minY = gridSize, maxY = -1;
    for (const key of allPoints) {
      const [xStr, yStr] = key.split(',');
      const x = parseInt(xStr);
      const y = parseInt(yStr);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    
    const processedCells = new Set();
    
    // First pass: Fill complete rectangular cells
    for (let cy = minY; cy < maxY; cy++) {
      for (let cx = minX; cx < maxX; cx++) {
        const cellKey = `${cx},${cy}`;
        if (processedCells.has(cellKey)) continue;
        
        const corners = [
          `${cx},${cy}`,
          `${cx+1},${cy}`,
          `${cx+1},${cy+1}`,
          `${cx},${cy+1}`
        ];
        
        if (corners.every(k => allPoints.has(k))) {
          processedCells.add(cellKey);
          const [c0, c1, c2, c3] = corners.map(k => vertexMap.get(k));
          
          if (c0 !== undefined && c1 !== undefined && c2 !== undefined && c3 !== undefined) {
            indices.push(c0, c1, c2);
            indices.push(c0, c2, c3);
            markCellEdges(c0, c1, c2, c3);
          }
        }
      }
    }
    
    // Second pass: Fill remaining areas with fan triangulation (only edges not in cells)
    for (const { x, y } of capturedDots) {
      const centerKey = `${x},${y}`;
      const centerIdx = vertexMap.get(centerKey);
      
      const neighbors = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          const nKey = `${nx},${ny}`;
          if (allPoints.has(nKey)) {
            neighbors.push({ x: nx, y: ny, key: nKey, dx, dy });
          }
        }
      }
      
      neighbors.sort((a, b) => {
        const angleA = Math.atan2(a.dy, a.dx);
        const angleB = Math.atan2(b.dy, b.dx);
        return angleA - angleB;
      });
      
      for (let i = 0; i < neighbors.length; i++) {
        const n1 = neighbors[i];
        const n2 = neighbors[(i + 1) % neighbors.length];
        
        const dist = Math.abs(n1.dx - n2.dx) + Math.abs(n1.dy - n2.dy);
        if (dist <= GameRenderer.NEIGHBOR_ADJACENCY_DISTANCE) {
          const n1Idx = vertexMap.get(n1.key);
          const n2Idx = vertexMap.get(n2.key);
          
          if (n1Idx !== undefined && n2Idx !== undefined) {
            // Only add this triangle if its edges aren't already part of a cell
            const edge1 = [centerIdx, n1Idx].sort((a, b) => a - b).join(',');
            const edge2 = [centerIdx, n2Idx].sort((a, b) => a - b).join(',');
            const edge3 = [n1Idx, n2Idx].sort((a, b) => a - b).join(',');
            
            if (!edgeSet.has(edge1) || !edgeSet.has(edge2) || !edgeSet.has(edge3)) {
              indices.push(centerIdx, n1Idx, n2Idx);
            }
          }
        }
      }
    }
    
    // Create geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    
    // Get pattern texture if available from current skin
    const patternTexture = skinManager.getPatternTexture(playerNum);
    
    let material;
    if (patternTexture) {
      material = new THREE.MeshBasicMaterial({
        map: patternTexture,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide
      });
    } else {
      material = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide
      });
    }
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = -0.15;
    mesh.userData = { targetOpacity: patternTexture ? 0.6 : 0.15, playerNum: playerNum };
    
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
    const spacing = GameRenderer.DOT_SPACING;
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
    const spacing = GameRenderer.DOT_SPACING;
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
   * Set a dot to have a pulsing animation (for pending touch moves)
   */
  setPendingDotPulse(x, y, playerNum = null) {
    const key = `${x},${y}`;
    this.pulsingDot = playerNum ? key : null;
    this.pulseTime = 0;
    
    // Set initial hover state
    if (playerNum) {
      this.setDotHoverTarget(x, y, true, playerNum);
    }
  }

  /**
   * Clear pulsing animation
   */
  clearPendingDotPulse() {
    if (this.pulsingDot) {
      const [x, y] = this.pulsingDot.split(',').map(Number);
      this.setDotHoverTarget(x, y, false);
      this.pulsingDot = null;
    }
  }

  /**
   * Update all dot animations for smooth transitions
   */
  updateDotAnimations() {
    // Update pulse animation for pending move
    if (this.pulsingDot) {
      this.pulseTime += 0.05;
      const pulseScale = 1.0 + Math.sin(this.pulseTime * 3) * 0.15; // Pulse between 0.85 and 1.15
      const pulseIntensity = 0.8 + Math.sin(this.pulseTime * 3) * 0.2; // Pulse emissive
      
      const anim = this.dotAnimations.get(this.pulsingDot);
      if (anim) {
        anim.targetScale = 1.4 * pulseScale;
        anim.targetEmissiveIntensity = pulseIntensity;
      }
    }
    
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
    // Use getNearestDot for better mobile support
    return this.getNearestDot();
  }
  
  /**
   * Get the nearest dot to mouse position with tolerance
   * Better for mobile devices where precise clicking is difficult
   */
  getNearestDot() {
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Get the point in 3D space where the ray intersects z=0 plane
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const intersectPoint = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(plane, intersectPoint);
    
    if (!intersectPoint) return null;
    
    // Find the nearest dot within tolerance
    let nearestDot = null;
    let nearestDistance = this.dotSelectionTolerance;
    
    for (const [key, mesh] of this.dotMeshes) {
      const distance = intersectPoint.distanceTo(mesh.position);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestDot = mesh;
      }
    }
    
    return nearestDot;
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
    
    // Recalculate minimum zoom for new aspect ratio
    this.minZoom = this.calculateMinZoom();
    
    // Clamp current zoom to valid range
    this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoomLevel));
    
    // Update camera with current zoom level
    this.updateCameraZoom();
    this.updateCameraPosition();

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
    
    // Reset zoom and pan
    this.resetZoomPan();
  }
}
