"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The panel every dialog is built out of, so none of them carries its own copy
 * of the keyboard rules.
 *
 * A dialog owns the keyboard while it is open: focus starts inside it, Tab
 * cycles within it, Escape closes it, and focus goes back to whatever opened
 * it. Without that, Tab wanders off behind the scrim.
 */
export default function Dialog({
  title,
  onClose,
  children,
  footer,
  wide = false,
  closeLabel = "Close",
  initialFocus,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Settings is a form and needs the full width. The short dialogs do not. */
  wide?: boolean;
  closeLabel?: string;
  /** Focused on open in place of the first thing in the panel. */
  initialFocus?: React.RefObject<HTMLElement | null>;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  // The page re renders about once a second while a sync runs, each time with
  // a fresh onClose. Read through a ref so the setup below runs once, on open.
  // Depending on onClose directly would drag focus back every second.
  // Written after the render rather than during it. It is only read from a
  // keypress, which cannot land while a render is in progress.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;

    // The last stop is the confirming button, and starting there would make
    // Enter agree to something before it had been read, so focus starts at the
    // first thing in the panel instead, which is the close button.
    const stops = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    (initialFocus?.current ?? stops?.[0])?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;

      const inside = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null,
      );
      if (!inside.length) return;

      const first = inside[0];
      const last = inside[inside.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      opener?.focus?.();
    };
    // Runs once, when the dialog opens. Listing `initialFocus` would tear the
    // trap down and set it up again whenever the caller passed a new ref, which
    // would drag focus back to the top mid typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hung off the body because the page carries a transform for its entry
  // animation, and a fixed box inside one is measured against that transform
  // rather than against the screen.
  return createPortal(
    <div className="modal">
      <div className="modal__scrim" onClick={onClose} />

      <div
        className={`modal__panel${wide ? "" : " modal__panel--sm"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
      >
        <header className="modal__head">
          <h2 className="modal__title" id={titleId}>
            {title}
          </h2>
          <button
            className="icon-btn modal__close"
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <X className="lucide" />
          </button>
        </header>

        <div className="modal__body">{children}</div>

        {footer ? <footer className="modal__foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
