"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The panel every short dialog is built out of, so the small ones do not each
 * carry their own copy of the keyboard rules. Settings keeps its own shell:
 * it is a form with its own focus order and is left where it is.
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
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  // The page re renders about once a second while a sync runs, and each render
  // hands this a fresh onClose. Read through a ref so the setup below happens
  // once, on open: without it every render would take focus back to the close
  // button while you were reading the dialog.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;

    // The last stop is the confirming button, and starting there would make
    // Enter agree to something before it had been read, so focus starts at the
    // first thing in the panel instead.
    const stops = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    stops?.[0]?.focus();

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
  }, []);

  // Hung off the body for the same reason Settings is: the page carries a
  // transform for its entry animation, and a fixed box inside one is measured
  // against that rather than against the screen.
  return createPortal(
    <div className="modal">
      <div className="modal__scrim" onClick={onClose} />

      <div
        className="modal__panel modal__panel--sm"
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
            aria-label="Close"
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
