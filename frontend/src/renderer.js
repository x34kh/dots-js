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
    this.dotMeshes = [];
    this.lineMeshes = new Map();
    this.territoryMeshes = new Map();
    this.previewMeshes = [];
    this.hoverDot = null;
    this.selectedDot = null;
    this.particles = [];
    this.animatingLines = [];
    
    this.playerColors = {
      1: new THREE.Color(0x00ffff), // Cyan
      2: new THREE.Color(0xff00ff)  // Magenta
    };
    
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
    this.dotMeshes = [];
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const dot = this.createDot(
          x * spacing - offset,
          y * spacing - offset,
          x,
          y
        );
        this.scene.add(dot);
        this.dotMeshes.push(dot);
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

  createLine(x1, y1, x2, y2, playerNum, animated = true) {
    const gridSize = this.boardLogic.gridSize;
    const spacing = 1.5;
    const offset = (gridSize - 1) * spacing / 2;

    const start = new THREE.Vector3(
      x1 * spacing - offset,
      y1 * spacing - offset,
      0.05
    );
    const end = new THREE.Vector3(
      x2 * spacing - offset,
      y2 * spacing - offset,
      0.05
    );

    const color = this.playerColors[playerNum];
    
    // Create line geometry
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([start, start]);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: color,
      linewidth: 3
    });
    const line = new THREE.Line(lineGeometry, lineMaterial);

    // Create thicker tube for better visibility
    const direction = end.clone().sub(start);
    const length = direction.length();
    const tubeGeometry = new THREE.CylinderGeometry(0.04, 0.04, length, 8);
    const tubeMaterial = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.5,
      metalness: 0.5,
      roughness: 0.3
    });
    const tube = new THREE.Mesh(tubeGeometry, tubeMaterial);
    
    // Position and rotate tube
    const midpoint = start.clone().add(end).multiplyScalar(0.5);
    tube.position.copy(midpoint);
    tube.rotation.z = Math.atan2(direction.y, direction.x) + Math.PI / 2;
    tube.scale.y = animated ? 0 : 1;

    const group = new THREE.Group();
    group.add(line);
    group.add(tube);
    group.userData = { x1, y1, x2, y2, playerNum, tube };

    this.scene.add(group);

    if (animated) {
      this.animatingLines.push({
        tube,
        targetScale: 1,
        speed: 0.1
      });
    }

    return group;
  }

  createTerritory(points, playerNum, animated = true) {
    const gridSize = this.boardLogic.gridSize;
    const spacing = 1.5;
    const offset = (gridSize - 1) * spacing / 2;

    const color = this.playerColors[playerNum];
    
    // Convert points to 3D coordinates
    const shape = new THREE.Shape();
    const firstPoint = points[0];
    shape.moveTo(firstPoint.x * spacing - offset, firstPoint.y * spacing - offset);
    
    for (let i = 1; i < points.length; i++) {
      const point = points[i];
      shape.lineTo(point.x * spacing - offset, point.y * spacing - offset);
    }
    shape.closePath();

    const geometry = new THREE.ShapeGeometry(shape);
    const material = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: animated ? 0 : 0.4,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = -0.1;
    mesh.userData = { playerNum, targetOpacity: 0.4 };

    this.scene.add(mesh);

    if (animated) {
      this.animateTerritory(mesh);
      this.createCaptureParticles(points, playerNum);
    }

    return mesh;
  }

  createPreviewTerritory(points) {
    const gridSize = this.boardLogic.gridSize;
    const spacing = 1.5;
    const offset = (gridSize - 1) * spacing / 2;

    const shape = new THREE.Shape();
    const firstPoint = points[0];
    shape.moveTo(firstPoint.x * spacing - offset, firstPoint.y * spacing - offset);
    
    for (let i = 1; i < points.length; i++) {
      const point = points[i];
      shape.lineTo(point.x * spacing - offset, point.y * spacing - offset);
    }
    shape.closePath();

    const geometry = new THREE.ShapeGeometry(shape);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = -0.05;

    this.scene.add(mesh);
    this.previewMeshes.push(mesh);

    return mesh;
  }

  createPreviewLine(x1, y1, x2, y2, playerNum) {
    const gridSize = this.boardLogic.gridSize;
    const spacing = 1.5;
    const offset = (gridSize - 1) * spacing / 2;

    const start = new THREE.Vector3(
      x1 * spacing - offset,
      y1 * spacing - offset,
      0.05
    );
    const end = new THREE.Vector3(
      x2 * spacing - offset,
      y2 * spacing - offset,
      0.05
    );

    const color = this.playerColors[playerNum];
    
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const lineMaterial = new THREE.LineDashedMaterial({
      color: color,
      dashSize: 0.1,
      gapSize: 0.05,
      transparent: true,
      opacity: 0.6
    });
    
    const line = new THREE.Line(lineGeometry, lineMaterial);
    line.computeLineDistances();

    this.scene.add(line);
    this.previewMeshes.push(line);

    return line;
  }

  clearPreviews() {
    this.previewMeshes.forEach(mesh => {
      this.scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    });
    this.previewMeshes = [];
  }

  highlightDot(dot, color = 0x00ffff) {
    if (dot) {
      dot.material.color.setHex(color);
      dot.material.emissive.setHex(color);
      dot.material.emissiveIntensity = 1;
      dot.scale.setScalar(1.3);
      
      if (dot.userData.ring) {
        dot.userData.ring.material.color.setHex(color);
        dot.userData.ring.material.opacity = 0.8;
      }
    }
  }

  unhighlightDot(dot) {
    if (dot) {
      dot.material.color.setHex(0x4a4a6a);
      dot.material.emissive.setHex(0x2a2a3a);
      dot.material.emissiveIntensity = 0.5;
      dot.scale.setScalar(1);
      
      if (dot.userData.ring) {
        dot.userData.ring.material.color.setHex(0x4a4a6a);
        dot.userData.ring.material.opacity = 0.3;
      }
    }
  }

  selectDot(dot, playerNum) {
    this.highlightDot(dot, this.playerColors[playerNum].getHex());
    this.selectedDot = dot;
  }

  deselectDot() {
    if (this.selectedDot) {
      this.unhighlightDot(this.selectedDot);
      this.selectedDot = null;
    }
  }

  createCaptureParticles(points, playerNum) {
    const gridSize = this.boardLogic.gridSize;
    const spacing = 1.5;
    const offset = (gridSize - 1) * spacing / 2;
    const color = this.playerColors[playerNum];

    // Calculate center of territory
    let centerX = 0, centerY = 0;
    points.forEach(p => {
      centerX += p.x * spacing - offset;
      centerY += p.y * spacing - offset;
    });
    centerX /= points.length;
    centerY /= points.length;

    // Create particles
    const particleCount = 30;
    for (let i = 0; i < particleCount; i++) {
      const geometry = new THREE.SphereGeometry(0.03 + Math.random() * 0.03, 8, 8);
      const material = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 1
      });
      
      const particle = new THREE.Mesh(geometry, material);
      particle.position.set(centerX, centerY, 0.1);
      
      const angle = (i / particleCount) * Math.PI * 2;
      const speed = 0.5 + Math.random() * 0.5;
      particle.userData = {
        velocity: new THREE.Vector3(
          Math.cos(angle) * speed,
          Math.sin(angle) * speed,
          Math.random() * 0.5
        ),
        life: 1
      };
      
      this.scene.add(particle);
      this.particles.push(particle);
    }
  }

  animateTerritory(mesh) {
    const animate = () => {
      if (mesh.material.opacity < mesh.userData.targetOpacity) {
        mesh.material.opacity += 0.02;
        requestAnimationFrame(animate);
      }
    };
    animate();
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

  updateAnimatingLines() {
    for (let i = this.animatingLines.length - 1; i >= 0; i--) {
      const anim = this.animatingLines[i];
      
      anim.tube.scale.y += (anim.targetScale - anim.tube.scale.y) * anim.speed;
      
      if (Math.abs(anim.tube.scale.y - anim.targetScale) < 0.01) {
        anim.tube.scale.y = anim.targetScale;
        this.animatingLines.splice(i, 1);
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
    const intersects = this.raycaster.intersectObjects(this.dotMeshes);
    
    if (intersects.length > 0) {
      return intersects[0].object;
    }
    return null;
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
    this.updateAnimatingLines();
    this.composer.render();
  }

  reset() {
    // Remove all lines
    this.lineMeshes.forEach(mesh => {
      this.scene.remove(mesh);
    });
    this.lineMeshes.clear();

    // Remove all territories
    this.territoryMeshes.forEach(mesh => {
      this.scene.remove(mesh);
    });
    this.territoryMeshes.clear();

    // Clear previews
    this.clearPreviews();

    // Clear particles
    this.particles.forEach(p => this.scene.remove(p));
    this.particles = [];

    // Reset dots
    this.dotMeshes.forEach(dot => this.unhighlightDot(dot));
    this.selectedDot = null;
    this.hoverDot = null;
  }
}
