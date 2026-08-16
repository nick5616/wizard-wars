// Cosmetic gate only — the server is the real check (Player.isLocalConnection,
// derived from the actual TCP remoteAddress). A deployed server never sees a
// loopback connection from a real external client either way.
export const IS_LOCALHOST = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
