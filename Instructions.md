TASK FOR AGENTIC AI — BUILD A THREEJS MULTIPLAYER GAME WITH GOOGLE AUTH, DEMO MODE, BACKEND, AND ELO SCORING

1. Core Game Concept: Implement a modern JS/ThreeJS multiplayer game based on an extended “Dots and Boxes” rule-set where players draw horizontal, vertical, or diagonal lines between adjacent dots on a 2D/3D-styled bright, neon-colored board; when a player completes a closed polygon, the game “captures” the maximal enclosed territory and assigns it to that player.

2. Visual Requirements: Use ThreeJS for rendering, with high-contrast vivid colors, glowing edges, soft shadows, bloom, interactive highlights on hover, animated line-drawing effects, dynamic particle bursts when territory is captured, and smooth transitions when a chain is claimed.

3. Game Rules: Allow connections only between directly adjacent dots (orthogonal or diagonal); when a move creates one or more closed shapes, compute the maximal polygon area internally and assign all enclosed cells/territory to the player; display preview highlight of the territory that will be captured when hovering over a valid dot or line endpoint before the move is taken; continue alternating turns unless a capture is made, in which case the player continues.

4. Gameplay Modes:

Demo Mode (P2P): Allow users to play without backend; generate a unique game link; use WebRTC or similar direct peer connection; synchronize moves, validate basic rules locally.

Full Mode (Backend): Provide a backend validating every move, detecting illegal lines, calculating territory capture, persisting game state, and updating ELO scores.

5. Authentication: Integrate Google OAuth (client-side for demo mode, server-side token verification for backend mode); store lightweight user profile with name, Google ID, and minimal avatar.

6. Game Architecture:

Frontend: Vanilla JS + ThreeJS + state machine managing board state, turn order, hover preview calculations, and animations.

Networking: WebRTC for P2P; WebSockets for server mode.

Backend: Node.js + Express + Redis/Postgres; endpoints for auth validation, match creation, state updates, score storage, and ELO calculation.

ELO Model: Maintain per-user rating; update after each backend-verified match; handle provisional players; store match logs.

7. Territory Detection: Implement polygon-closure detection: when a line is placed, run BFS/DFS on adjacency graph to find any new closed loops; compute polygon area (Shoelace formula or triangulation), fill territory, assign ownership; animate gradual color fill.

8. Hover Preview System: When cursor hovers over a valid connection point, simulate the hypothetical line; run closure detection; highlight all territory that would be captured if this move is submitted.

9. UI Requirements: Add minimalistic but vivid UI: player indicators, scores, turn highlight, animated capture notifications, end-of-game summary, rematch button, and shareable link for demo games.

10. Security & Validation: In backend mode validate all moves server-side, reject inconsistent state updates, restrict board manipulation to active players, and verify OAuth tokens on each critical request.

11. Deployment: Build Dockerized backend; deploy frontend as static site; support HTTPS for WebRTC; enable CORS for link-based matches.

12. Deliverables: Fully running game, documented API, architecture diagrams, test cases for move-validation and area-capture logic, and reproducible deployment scripts.
