"use client";

import { useEffect, useState } from "react";
import { LIST_WIDTH_MAX, LIST_WIDTH_MIN } from "@/lib/hooks";

/** How far one arrow key moves the divider, and how far one with Shift held. */
const STEP = 16;
const BIG_STEP = 48;

/**
 * The divider between the list and the reading pane.
 *
 * It sits on the list pane's own right edge rather than being placed by
 * measuring the grid, so it follows the pane wherever the layout puts it and
 * there is no second copy of the column widths to keep in step.
 *
 * A drag is measured off the pane's real width rather than off the stored
 * number, because the stylesheet caps the pane at a share of the window as
 * well, and past that cap the two disagree.
 *
 * It answers the keyboard as well as the pointer, which is what makes it a
 * separator rather than a decoration only a mouse can reach.
 */
export default function SplitHandle({
  width,
  paneRef,
  onWidth,
}: {
  /** The stored width, and null while the pane is still at its own default. */
  width: number | null;
  paneRef: React.RefObject<HTMLElement | null>;
  onWidth: (px: number | null) => void;
}) {
  const [dragging, setDragging] = useState(false);

  // The pointer leaves the handle long before the drag ends, so the cursor and
  // the ban on selecting text belong to the page for as long as it lasts.
  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add("is-resizing");
    return () => document.body.classList.remove("is-resizing");
  }, [dragging]);

  const paneWidth = () => paneRef.current?.getBoundingClientRect().width ?? LIST_WIDTH_MIN;

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Only the primary button drags, and never a right click opening a menu.
    if (event.button !== 0) return;
    event.preventDefault();

    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = paneWidth();

    // Captured, so the events keep arriving at the handle once the pointer has
    // run ahead of it, which it does on every drag of any speed.
    handle.setPointerCapture(event.pointerId);
    setDragging(true);

    const move = (moved: PointerEvent) => onWidth(startWidth + moved.clientX - startX);
    const done = () => {
      setDragging(false);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", done);
      handle.removeEventListener("pointercancel", done);
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", done);
    handle.addEventListener("pointercancel", done);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? BIG_STEP : STEP;
    if (event.key === "ArrowLeft") onWidth(paneWidth() - step);
    else if (event.key === "ArrowRight") onWidth(paneWidth() + step);
    else if (event.key === "Home") onWidth(LIST_WIDTH_MIN);
    else if (event.key === "End") onWidth(LIST_WIDTH_MAX);
    else return;
    event.preventDefault();
  }

  return (
    <div
      className={`handle${dragging ? " is-dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the Applications list"
      aria-valuemin={LIST_WIDTH_MIN}
      aria-valuemax={LIST_WIDTH_MAX}
      aria-valuenow={width ?? undefined}
      title="Drag to resize, double click to reset"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onWidth(null)}
    />
  );
}
