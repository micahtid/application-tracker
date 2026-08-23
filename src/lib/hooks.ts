"use client";

import { useEffect, useRef } from "react";

/**
 * Closes a menu when a click lands anywhere else. The menus themselves stop
 * clicks inside them from propagating, so this only ever sees the outside.
 *
 * `onDismiss` is read through a ref because the page re renders about once a
 * second while a sync runs. Depending on the callback directly would tear the
 * listener down and add it again on every one of those renders.
 */
export function useDismissOnOutsideClick(active: boolean, onDismiss: () => void): void {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (!active) return;
    const close = () => dismiss.current();
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [active]);
}
