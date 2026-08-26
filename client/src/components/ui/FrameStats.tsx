import { useEffect, useRef } from 'react';
import { BODY_FONT } from '../../styles/fonts';

/**
 * CS2-style net-graph readout for the render loop itself: FPS, current frame
 * time, and a rolling count of "dropped" frames (frame time > 2x the 60fps
 * budget, i.e. something stalled the main thread for 33ms+). Deliberately
 * NOT driven by React state -- this exists to diagnose main-thread jank, so
 * measuring it can't itself be a source of React re-render overhead. Runs
 * its own requestAnimationFrame loop and writes straight into the DOM via
 * refs, same imperative pattern as CameraController/RemotePlayer use for
 * position.
 */
const DROPPED_FRAME_MS = 1000 / 30; // a frame took longer than the 30fps budget
const WINDOW_MS = 1000; // recompute the readout once per second of samples

const color = (fps: number) => (fps < 45 ? '#ff5555' : fps < 55 ? '#ffcc44' : '#88cc88');

export function FrameStats() {
  const fpsRef = useRef<HTMLSpanElement>(null);
  const frameTimeRef = useRef<HTMLSpanElement>(null);
  const droppedRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let windowStart = last;
    let framesInWindow = 0;
    let droppedInWindow = 0;
    let maxFrameMs = 0;

    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      framesInWindow++;
      if (dt > maxFrameMs) maxFrameMs = dt;
      if (dt > DROPPED_FRAME_MS) droppedInWindow++;

      const elapsed = now - windowStart;
      if (elapsed >= WINDOW_MS) {
        const fps = Math.round((framesInWindow * 1000) / elapsed);
        if (fpsRef.current) {
          fpsRef.current.textContent = `${fps} FPS`;
          fpsRef.current.style.color = color(fps);
        }
        if (frameTimeRef.current) frameTimeRef.current.textContent = `${maxFrameMs.toFixed(0)}ms max`;
        if (droppedRef.current) {
          droppedRef.current.textContent = `${droppedInWindow} dropped`;
          droppedRef.current.style.color = droppedInWindow > 0 ? '#ff5555' : '#88cc88';
        }
        windowStart = now;
        framesInWindow = 0;
        droppedInWindow = 0;
        maxFrameMs = 0;
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div style={{
      position: 'fixed',
      top: 56,
      left: 12,
      fontFamily: BODY_FONT,
      fontSize: 12,
      letterSpacing: 1,
      pointerEvents: 'none',
      zIndex: 100,
      display: 'flex',
      gap: 10,
      background: 'rgba(6,6,16,0.55)',
      padding: '3px 7px',
      borderRadius: 2,
    }}>
      <span ref={fpsRef} style={{ color: '#88cc88' }}>-- FPS</span>
      <span ref={frameTimeRef} style={{ color: '#ccc' }}>-- max</span>
      <span ref={droppedRef} style={{ color: '#88cc88' }}>-- dropped</span>
    </div>
  );
}
