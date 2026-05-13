# Wizard Game

A multiplayer 3D wizard battle game built with React Three Fiber on the frontend and a Node.js WebSocket server on the backend, using Redis for state management.

## Architecture

```
wizard-game/
├── client/   # React + Three.js frontend (Vite, TypeScript)
├── server/   # Node.js WebSocket game server
└── shared/   # Shared constants, events, and game config
```

## Prerequisites

- **Node.js** v18+
- **npm** v9+
- **Redis** running locally on port `6379`

### Install Redis (macOS)

```bash
brew install redis
brew services start redis
```

Verify Redis is running:

```bash
redis-cli ping
# Expected output: PONG
```

## Setup

Install all dependencies from the root (installs client, server, and shared workspaces):

```bash
npm install
```

## Running in Development

Start both the server and client together with hot reload:

```bash
npm run dev
```

- Client: http://localhost:3000
- Server: ws://localhost:8080

Or start them separately:

```bash
# Terminal 1 — game server
npm run start:server

# Terminal 2 — client dev server
npm run start:client
```

## Environment Variables

The server reads these at startup (defaults shown):

| Variable    | Default                    | Description              |
|-------------|----------------------------|--------------------------|
| `PORT`      | `8080`                     | WebSocket server port    |
| `REDIS_URL` | `redis://127.0.0.1:6379`   | Redis connection string  |

Override them inline:

```bash
PORT=9090 REDIS_URL=redis://myhost:6379 npm run start:server
```

## Building for Production

```bash
# Build the client
npm run build -w client

# Run the server (no hot reload)
npm run start -w server
```

The built client output lands in `client/dist/`. Serve it with any static file server and point it at the production WebSocket server.
# wizard-wars
