import { useState, useEffect, useCallback, useRef } from 'react';

interface MouseState {
  deltaX: number;
  deltaY: number;
  isLocked: boolean;
  lmbDown: boolean;
  rmbDown: boolean;
}

export function useMouseControls() {
  const [isLocked, setIsLocked] = useState(false);
  const delta = useRef({ x: 0, y: 0 });
  const lmbRef = useRef(false);
  const rmbRef = useRef(false);
  const mmbRef = useRef(false);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!document.pointerLockElement) return;
    delta.current.x += e.movementX;
    delta.current.y += e.movementY;
  }, []);

  const onMouseDown = useCallback((e: MouseEvent) => {
    // The click that *acquires* pointer lock (canvas click while unlocked -- entering the
    // game, or coming back from the pause menu) must only lock, not also fire the equipped
    // spell: standard FPS behaviour, and otherwise every re-entry wastes a cast/cooldown.
    const acquiringLock = !document.pointerLockElement && e.target instanceof HTMLCanvasElement;
    if (e.button === 0 && !acquiringLock) lmbRef.current = true;
    if (e.button === 2 && !acquiringLock) rmbRef.current = true;
    if (e.button === 1) { mmbRef.current = true; e.preventDefault(); } // middle click: don't let the OS autoscroll icon pop up

    // Only acquire pointer lock when clicking the canvas itself — not UI overlays.
    // This lets modal buttons receive clicks normally.
    if (acquiringLock) {
      (e.target as HTMLCanvasElement).requestPointerLock();
    }
  }, []);

  const onMouseUp = useCallback((e: MouseEvent) => {
    if (e.button === 0) lmbRef.current = false;
    if (e.button === 2) rmbRef.current = false;
    if (e.button === 1) mmbRef.current = false;
  }, []);

  const onLockChange = useCallback(() => {
    const locked = !!document.pointerLockElement;
    setIsLocked(locked);
  }, []);

  const onContextMenu = useCallback((e: Event) => e.preventDefault(), []);

  // Same missed-release problem as keyboard: a mouseup delivered to another
  // window / after alt-tab never reaches us, leaving LMB "held" (auto-fire
  // of held-fire spells, stuck aim-down) until the next click.
  const releaseButtons = useCallback(() => {
    lmbRef.current = false;
    rmbRef.current = false;
    mmbRef.current = false;
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('blur', releaseButtons);
    return () => {
      window.removeEventListener('blur', releaseButtons);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('contextmenu', onContextMenu);
    };
  }, [onMouseMove, onMouseDown, onMouseUp, onLockChange, onContextMenu, releaseButtons]);

  /** Call each frame to consume accumulated delta. */
  function consumeDelta() {
    const d = { ...delta.current };
    delta.current.x = 0;
    delta.current.y = 0;
    return d;
  }

  return { isLocked, consumeDelta, lmbRef, rmbRef, mmbRef };
}
