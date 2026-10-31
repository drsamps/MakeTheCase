import React, { useRef } from 'react';

/**
 * Long press (touch or mouse) on a button: calls onLongPress after `ms`, and swallows the
 * click that follows so the button's normal action does not also run. Spread the returned
 * handlers on the element, and route its onClick through `wrapClick`.
 */
export function useLongPress(onLongPress: () => void, ms = 600) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const handlers = {
    onPointerDown: () => {
      fired.current = false;
      clear();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        timer.current = null;
        onLongPress();
      }, ms);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    // Stop the phone's own long-press menu.
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };

  const wrapClick = (onClick: (e: React.MouseEvent) => void) => (e: React.MouseEvent) => {
    if (fired.current) {
      fired.current = false;
      e.preventDefault();
      return;
    }
    onClick(e);
  };

  return { handlers, wrapClick };
}
