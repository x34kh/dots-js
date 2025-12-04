# API Documentation

## REST API Endpoints

### Authentication

#### POST /api/auth/verify
Verify a Google OAuth token.

**Request Body:**
```json
{
  "token": "google-id-token"
}
```

**Response:**
```json
{
  "user": {
    "id": "google-user-id",
    "name": "User Name",
    "email": "user@example.com",
    "picture": "https://..."
  }
}
```

#### POST /api/auth/anonymous
Create anonymous user credentials.

**Response:**
```json
{
  "anonymousId": "anon-abc123...",
  "username": "SwiftFox123",
  "signature": "hmac-signature-hex"
}
```

Also sets secure HTTP-only cookies:
- `anon_id`: Anonymous user ID
- `anon_name`: Username
- `anon_sig`: HMAC signature

#### POST /api/auth/anonymous/verify
Verify anonymous credentials.

**Request Body:**
```json
{
  "anonymousId": "anon-abc123...",
  "username": "SwiftFox123",
  "signature": "hmac-signature-hex"
}
```

**Response:**
```json
{
  "valid": true,
  "user": {
    "id": "anon-abc123...",
    "name": "SwiftFox123",
    "isAnonymous": true
  }
}
```

### Games

#### GET /api/games/:gameId
Get game information.

**Response:**
```json
{
  "id": "game-uuid",
  "players": {
    "1": { "id": "user-id", "name": "Player 1" },
    "2": { "id": "user-id", "name": "Player 2" }
  },
  "scores": { "1": 5, "2": 3 },
  "currentPlayer": 1,
  "status": "playing",
  "winner": null
}
```

### Statistics

#### GET /api/stats/:userId
Get player statistics.

**Response:**
```json
{
  "userId": "user-id",
  "rating": 1523,
  "gamesPlayed": 15,
  "wins": 9,
  "losses": 6,
  "draws": 0,
  "winRate": "60.0%"
}
```

#### GET /api/leaderboard
Get top players.

**Query Parameters:**
- `limit` (optional): Number of results (default: 10)

**Response:**
```json
[
  { "userId": "user1", "rating": 1800, "wins": 50 },
  { "userId": "user2", "rating": 1750, "wins": 45 }
]
```

#### GET /api/matches/:userId
Get match history for a player.

**Query Parameters:**
- `limit` (optional): Number of results (default: 20)

**Response:**
```json
[
  {
    "id": 1,
    "gameId": "game-uuid",
    "player1Id": "user1",
    "player2Id": "user2",
    "winner": 1,
    "scores": { "1": 10, "2": 5 },
    "timestamp": "2024-01-01T12:00:00Z"
  }
]
```

## WebSocket API

Connect to: `ws://server:8080/ws`

### Authentication

#### Google OAuth Auth
```json
{
  "type": "auth",
  "token": "google-id-token"
}
```

#### Anonymous Auth
```json
{
  "type": "auth_anonymous",
  "anonymousId": "anon-abc123...",
  "username": "SwiftFox123",
  "signature": "hmac-signature-hex"
}
```

**Response:**
```json
{
  "type": "auth_success",
  "data": {
    "userId": "user-id",
    "name": "User Name",
    "isAnonymous": false
  }
}
```

### Game Actions

#### Create Game
```json
{ "type": "create_game" }
```

**Response:**
```json
{
  "type": "game_created",
  "data": {
    "gameId": "game-uuid",
    "playerNumber": 1
  }
}
```

#### Join Game
```json
{
  "type": "join_game",
  "gameId": "game-uuid"
}
```

#### Find Match (Matchmaking)
```json
{ "type": "find_match" }
```

#### Cancel Matchmaking
```json
{ "type": "cancel_match" }
```

#### Submit Move
```json
{
  "type": "move",
  "move": {
    "x1": 0, "y1": 0,
    "x2": 1, "y2": 0
  }
}
```

**Response:**
```json
{
  "type": "move_result",
  "data": {
    "success": true,
    "move": { "x1": 0, "y1": 0, "x2": 1, "y2": 0 },
    "playerNum": 1,
    "captures": [],
    "continuesTurn": false,
    "currentPlayer": 2,
    "gameOver": false
  }
}
```

#### Rematch Request
```json
{ "type": "rematch" }
```

#### Resign
```json
{ "type": "resign" }
```

### Server Events

#### Game Start
```json
{
  "type": "game_start",
  "data": {
    "gameId": "game-uuid",
    "playerNumber": 1,
    "player1": { "id": "...", "name": "Player 1" },
    "player2": { "id": "...", "name": "Player 2" },
    "currentPlayer": 1
  }
}
```

#### Opponent Move
```json
{
  "type": "opponent_move",
  "data": {
    "move": { "x1": 0, "y1": 0, "x2": 1, "y2": 0 },
    "playerNum": 2,
    "captures": [],
    "currentPlayer": 1,
    "gameOver": false
  }
}
```

#### Game Over
```json
{
  "type": "game_over",
  "data": {
    "winner": 1,
    "scores": { "1": 10, "2": 5 },
    "players": { ... }
  }
}
```

#### Opponent Disconnected
```json
{ "type": "opponent_disconnected" }
```

## Error Responses

All errors follow this format:
```json
{
  "type": "error",
  "error": "Error message"
}
```

Or for REST API:
```json
{
  "error": "Error message"
}
```

## Security

### Anonymous User Token Security

Anonymous user credentials use HMAC-SHA256 signing to prevent spoofing:

1. Server generates a unique `anonymousId` and `username`
2. Server creates HMAC-SHA256 signature: `HMAC(anonymousId + ":" + username, secret)`
3. Credentials are stored in secure, HTTP-only cookies
4. Client sends credentials for verification
5. Server verifies signature matches using timing-safe comparison

This prevents:
- Username spoofing (changing username invalidates signature)
- ID spoofing (changing ID invalidates signature)
- Token forgery (requires server secret)
