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

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!document.pointerLockElement) return;
    delta.current.x += e.movementX;
    delta.current.y += e.movementY;
  }, []);

  const onMouseDown = useCallback((e: MouseEvent) => {
    if (e.button === 0) lmbRef.current = true;
    if (e.button === 2) rmbRef.current = true;

    // Only acquire pointer lock when clicking the canvas itself — not UI overlays.
    // This lets modal buttons receive clicks normally.
    if (!document.pointerLockElement && e.target instanceof HTMLCanvasElement) {
      e.target.requestPointerLock();
    }
  }, []);

  const onMouseUp = useCallback((e: MouseEvent) => {
    if (e.button === 0) lmbRef.current = false;
    if (e.button === 2) rmbRef.current = false;
  }, []);

  const onLockChange = useCallback(() => {
    const locked = !!document.pointerLockElement;
    setIsLocked(locked);
  }, []);

  const onContextMenu = useCallback((e: Event) => e.preventDefault(), []);

  useEffect(() => {
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('contextmenu', onContextMenu);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('contextmenu', onContextMenu);
    };
  }, [onMouseMove, onMouseDown, onMouseUp, onLockChange, onContextMenu]);

  /** Call each frame to consume accumulated delta. */
  function consumeDelta() {
    const d = { ...delta.current };
    delta.current.x = 0;
    delta.current.y = 0;
    return d;
  }

  return { isLocked, consumeDelta, lmbRef, rmbRef };
}
