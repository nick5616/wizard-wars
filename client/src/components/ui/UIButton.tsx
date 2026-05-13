import type { CSSProperties, MouseEvent, ReactNode } from 'react';

interface UIButtonProps {
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  style?: CSSProperties;
  disabled?: boolean;
  onMouseEnter?: (e: MouseEvent<HTMLButtonElement>) => void;
  onMouseLeave?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Pass true for buttons that return the user to gameplay — re-acquires pointer lock after click. */
  locksPointer?: boolean;
}

/**
 * Drop-in button that releases pointer lock before firing onClick so UI
 * buttons are clickable even when the canvas has the mouse captured.
 * Set locksPointer to re-acquire the lock after click (for "back to game" buttons).
 */
export function UIButton({ onClick, children, style, disabled, onMouseEnter, onMouseLeave, locksPointer }: UIButtonProps) {
  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    onClick?.(e);
    if (locksPointer) {
      // Re-acquire after the current event settles so the modal has unmounted
      setTimeout(() => {
        const canvas = document.querySelector('canvas');
        if (canvas && !document.pointerLockElement) {
          canvas.requestPointerLock();
        }
      }, 50);
    }
  }

  return (
    <button
      onClick={handleClick}
      style={style}
      disabled={disabled}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </button>
  );
}
