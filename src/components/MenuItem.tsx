"use client";

import { Check } from "lucide-react";

/**
 * One choosable line in a popover menu.
 *
 * Four menus draw this same button with the same tick beside it, and differ
 * only in what the tick means, what it says, and what a click does.
 */
export default function MenuItem({
  role,
  checked,
  onClick,
  children,
}: {
  role: "menuitemradio" | "menuitemcheckbox";
  checked: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className="menu__item" role={role} aria-checked={checked} onClick={onClick}>
      <Check className="lucide" />
      {children}
    </button>
  );
}
