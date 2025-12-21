# Lobby System Documentation

## Overview

The lobby system provides a comprehensive matchmaking and player profile interface for online games. When players click "Play Online (Google)" they are now directed to a lobby screen instead of immediately entering matchmaking.

## Features

### Player Profile Display
- **Profile Picture**: Google profile picture or placeholder
- **Player Name**: Display name from Google account
- **ELO Rating**: Current rating with gold highlighting
- **Statistics Grid**:
  - Games Played
  - Wins
  - Losses
  - Draws
  - Win Rate (%)

### Match History
- **Recent Matches**: Last 10 games played
- **Match Details**:
  - Result (WIN/LOSS/DRAW) with color coding
  - Opponent name
  - Score display (My Score - Opponent Score)
  - Ranked/Unranked badge
  - Date played
- **Visual Indicators**:
  - Green border for wins
  - Red border for losses
  - Orange border for draws

### Matchmaking Queue
- **Two Queue Types**:
  - **Ranked Queue**: Affects ELO rating
  - **Unranked Queue**: Casual games without rating changes
- **Queue Controls**:
  - Join Ranked Queue button
  - Join Unranked Queue button
  - Cancel button when in queue
- **Queue Status**: Real-time feedback while waiting for opponent

### Live Statistics
- **Players Online**: Total connected players
- **In Queue**: Players currently waiting for a match
- **Playing**: Players currently in active games
- Auto-updates when players connect/disconnect/join queues

## Backend Implementation

### Enhanced EloService
**File**: `backend/src/elo/eloService.js`

- **recordMatch()**: Stores detailed match data
  ```javascript
  {
    gameId: string,
    player1Id: string,
    player1Name: string,
    player1Score: number,
    player2Id: string,
    player2Name: string,
    player2Score: number,
    winnerId: string | null,
    isRanked: boolean,
    completedAt: Date
  }
  ```

- **getMatchHistory()**: Returns formatted match history
  ```javascript
  [
    {
      opponentId: string,
      opponentName: string,
      myScore: number,
      opponentScore: number,
      result: 'win' | 'loss' | 'draw',
      isRanked: boolean,
      completedAt: Date
    }
  ]
  ```

### GameManager Enhancements
**File**: `backend/src/game/gameManager.js`

- **Dual Queue System**:
  - `rankedQueue[]`: Players waiting for ranked matches
  - `unrankedQueue[]`: Players waiting for unranked matches

- **addToMatchmaking(playerId, playerData, isRanked)**:
  - Adds player to appropriate queue
  - Returns match result when opponent found

- **getQueueStats()**:
  - Returns current queue and game counts
  - Used for live statistics display

- **handleGameOver()**:
  - Only updates ELO for ranked games
  - Records all matches with isRanked flag

### REST API Endpoints
**File**: `backend/src/routes/index.js`

- **GET /api/profile/:userId**
  - Returns player stats + recent matches
  - Response: `{ rating, gamesPlayed, wins, losses, draws, winRate, recentMatches[] }`

- **GET /api/stats/online**
  - Returns real-time player counts
  - Response: `{ playersOnline, playersInQueue, playersPlaying, rankedQueue, unrankedQueue, activeGames }`

### WebSocket Enhancements
**File**: `backend/src/websocket/wsHandler.js`

- **broadcastQueueStats()**:
  - Broadcasts to all connected clients when:
    - Player connects/disconnects
    - Player joins/leaves queue
    - Match is created
  - Message type: `queue_stats`

- **Updated Messages**:
  - `find_match`: Now includes `isRanked` flag
  - `game_start`: Now includes `isRanked` flag
  - `matchmaking`: Status updates include queue type

## Frontend Implementation

### LobbyUI Component
**File**: `frontend/src/lobby.js`

- **Constructor**: `new LobbyUI(websocket, authState)`
  - websocket: WebSocketClient instance
  - authState: `{ userId, name, picture }`

- **show()**: Displays lobby screen
  - Loads profile data from `/api/profile/:userId`
  - Renders UI with current stats
  - Sets up event listeners
  - Subscribes to queue_stats updates

- **Key Methods**:
  - `joinQueue(isRanked)`: Sends find_match message
  - `cancelQueue()`: Removes from queue
  - `updateQueueStats()`: Updates live statistics display
  - `renderMatchHistory()`: Displays recent games

### GameController Integration
**File**: `frontend/src/gameController.js`

- **startOnlineGame()**:
  - Checks authentication
  - Connects to WebSocket server
  - Shows lobby screen (instead of immediate matchmaking)

- **showLobby()**:
  - Creates LobbyUI instance
  - Hides menu and game canvas
  - Displays lobby interface

- **setupWebSocketEvents()**:
  - When `game_start` received:
    - Hides lobby
    - Shows game canvas
    - Starts game

### WebSocketClient Updates
**File**: `frontend/src/websocket.js`

- **findMatch(isRanked)**: Sends ranked/unranked flag
- **handleMessage()**: Added `queue_stats` case
- **Event Emitter**: Emits `queue_stats` for lobby to consume

## User Flow

1. **Click "Play Online (Google)"**
   - Triggers Google Sign-In (if not authenticated)
   - Connects to WebSocket server
   - Shows lobby screen

2. **Lobby Screen**
   - View profile and statistics
   - See recent match history
   - View live player counts
   - Choose ranked or unranked queue

3. **Join Queue**
   - Click "Join Ranked Queue" or "Join Unranked Queue"
   - See "Searching for match..." status
   - Real-time queue statistics update
   - Can cancel at any time

4. **Match Found**
   - Lobby hides automatically
   - Game canvas displays
   - Game starts immediately
   - ELO updated after game (ranked only)

5. **Return to Lobby**
   - After game completion
   - Can start new search immediately
   - Match history updates with latest game

## Styling

The lobby includes comprehensive CSS styling with:
- Responsive grid layout
- Profile cards with stats
- Color-coded match results
- Animated loading spinner
- Online statistics display
- Mobile responsive design

## Testing

All backend tests pass:
```
✓ 63 tests passing
✓ 31 test suites
```

Key test coverage:
- EloService match recording
- GameManager queue management
- Board logic
- Authentication
- Territory detection

## Configuration

No additional configuration required. The lobby system uses existing backend URL configuration:
- `window.GAME_CONFIG.backendUrl`
- `import.meta.env.VITE_BACKEND_URL`
- Fallback to `http://localhost:3001`

## Future Enhancements

Potential improvements:
1. Player search/invite system
2. Friends list
3. Chat functionality
4. Tournament brackets
5. Achievements and badges
6. Detailed ELO history graph
7. Replay system
8. Spectator mode
9. Custom game settings (board size, time controls)
10. Seasonal rankings/leaderboards

## Technical Notes

- All WebSocket messages are real-time
- Queue statistics broadcast to all clients on changes
- Profile data cached until page refresh
- Match history limited to 10 recent games in lobby
- Full history available via `/api/matches/:userId?limit=N`
- ELO calculations only apply to ranked games
- Unranked games still recorded in match history
