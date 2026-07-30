import type * as THREE from 'three';

// Imperative registry of remote-player Object3Ds, keyed by playerId.
// Populated by RemotePlayer on mount/unmount, consumed by CameraController's
// raycaster to resolve a `targetId` for direct-target spells (shatter,
// petrify, amaterasu, death_note) -- these require a targetId server-side
// and previously never got one since nothing raycast the crosshair.

const registry = new Map<string, THREE.Object3D>();

export function registerTarget(playerId: string, obj: THREE.Object3D) {
  obj.userData.playerId = playerId;
  registry.set(playerId, obj);
}

export function unregisterTarget(playerId: string) {
  registry.delete(playerId);
}

export function getTargetObjects(): THREE.Object3D[] {
  return [...registry.values()];
}
