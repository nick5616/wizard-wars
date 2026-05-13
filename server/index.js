import { GameServer } from './src/GameServer.js';

const PORT = parseInt(process.env.PORT ?? '8080', 10);
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

const server = new GameServer({ port: PORT, redisUrl: REDIS_URL });
await server.start();

process.on('SIGTERM', () => server.stop());
process.on('SIGINT',  () => server.stop());
