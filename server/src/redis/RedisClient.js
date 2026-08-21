import Redis from 'ioredis';

export class RedisClient {
  constructor(url) {
    this.url = url;
    this.client = null;
  }

  async connect() {
    this.client = new Redis(this.url, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.client.on('error', (err) => {
      console.warn('[Redis] Connection error (game continues without persistence):', err.message);
    });

    try {
      await this.client.connect();
      console.log('[Redis] Connected to', this.url);
    } catch (e) {
      console.warn('[Redis] Could not connect — running without persistence:', e.message);
    }
  }

  async disconnect() {
    await this.client?.quit();
  }

  async set(key, value, ttlSeconds) {
    if (this.client?.status !== 'ready') return;
    try {
      const json = JSON.stringify(value);
      if (ttlSeconds) {
        await this.client.setex(key, ttlSeconds, json);
      } else {
        await this.client.set(key, json);
      }
    } catch { /* no-op */ }
  }

  async get(key) {
    if (this.client?.status !== 'ready') return null;
    try {
      const raw = await this.client.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async del(key) {
    try { await this.client?.del(key); } catch { /* no-op */ }
  }
}
