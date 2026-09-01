"use client";

import { Check } from "lucide-react";

/**
 * One choosable line in a popover menu.
 *
 * The sort menu over the list and the status list in a row menu draw this same
 * button with the same tick beside it, and differ only in what the tick means,
 * what it says, and what a click does.
 */
export default function MenuItem({
  role,
  checked,
  onClick,
  className = "",
  children,
}: {
  role: "menuitemradio" | "menuitemcheckbox";
  checked: boolean;
  onClick: () => void;
  /** A modifier for a menu that lays its lines out differently. */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`menu__item${className ? " " + className : ""}`}
      role={role}
      aria-checked={checked}
      onClick={onClick}
    >
      <Check className="lucide" />
      {children}
    </button>
  );
}
