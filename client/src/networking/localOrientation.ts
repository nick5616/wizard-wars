// Imperative mirror of the local player's yaw/pitch, updated every frame by
// CameraController and read every frame by LocalPlayerModel (third-person).
// Deliberately not in the zustand store -- it changes every frame and
// nothing needs to re-render off it, just read the current value.
export const localOrientation = { yaw: 0, pitch: 0 };
