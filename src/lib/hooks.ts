"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DESIGNS, type Design } from "@/lib/view";

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

  // Written after the render rather than during it. The listener below only
  // reads it from a click, which cannot land while a render is in progress.
  useEffect(() => {
    dismiss.current = onDismiss;
  });

  useEffect(() => {
    if (!active) return;
    const close = () => dismiss.current();
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [active]);
}

/**
 * A choice about this screen, read out of the browser's own storage.
 *
 * The two hooks below keep their choice there rather than in the database,
 * because that is what each of them is: the same account can want a sheet on a
 * monitor and a split view on a laptop, and a width dragged on one screen means
 * nothing on another. Both read after the first paint rather than during the
 * first render, because the server cannot see this browser's storage and the
 * markup it sent would disagree with the markup the browser builds.
 *
 * A browser set to refuse storage throws on either call. Only the remembering
 * is lost, so neither of them says anything about it.
 */
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The same in the other direction, where `null` clears the key. */
function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* nothing to do */
  }
}

const DESIGN_KEY = "tracker.design";

const isDesign = (value: string | null): value is Design => DESIGNS.includes(value as Design);

/** Which design the rows are drawn in, and the setter that stores it. */
export function useDesign(): [Design, (next: Design) => void] {
  const [design, setDesign] = useState<Design>("board");

  useEffect(() => {
    const saved = readStored(DESIGN_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isDesign(saved)) setDesign(saved);
  }, []);

  const chooseDesign = useCallback((next: Design) => {
    setDesign(next);
    writeStored(DESIGN_KEY, next);
  }, []);

  return [design, chooseDesign];
}

/**
 * How wide the list pane may be dragged, in pixels.
 *
 * A fixed pair rather than a measurement of the window, because the stylesheet
 * holds the real limit: it never lets the list take the reading pane below
 * `--read-min`, whatever number is stored here. So the top end only has to be
 * past any width worth dragging to on a wide screen, rather than exact.
 */
export const LIST_WIDTH_MIN = 300;
export const LIST_WIDTH_MAX = 1000;

/** Where the dragged width is kept, in the same namespace as the design. */
const LIST_WIDTH_KEY = "tracker.listWidth";

const clampWidth = (px: number) => Math.round(Math.min(Math.max(px, LIST_WIDTH_MIN), LIST_WIDTH_MAX));

/**
 * The width the divider has been dragged to, and the setter that stores it.
 *
 * `null` means it has never been dragged, and the stylesheet uses its own
 * starting width for the screen it is on. Passing `null` back puts it there
 * again, which is what a double click on the divider does.
 */
export function useListWidth(): [number | null, (px: number | null) => void] {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const px = Number(readStored(LIST_WIDTH_KEY));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (px) setWidth(clampWidth(px));
  }, []);

  const chooseWidth = useCallback((px: number | null) => {
    const next = px === null ? null : clampWidth(px);
    setWidth(next);
    writeStored(LIST_WIDTH_KEY, next === null ? null : String(next));
  }, []);

  return [width, chooseWidth];
}
