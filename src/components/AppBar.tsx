"use client";

import { Columns2, Eraser, RefreshCw, Search, Settings, Table } from "lucide-react";
import type { Design } from "@/lib/view";

/**
 * The bar across the top of the screen: who you are, the search everything
 * runs through, and the four buttons that act on the whole board.
 *
 * The tools sit at the far right in two groups split by a hairline: what acts
 * on the mail, then what changes the screen. The safe, often used button comes
 * first in each group, and the gear stays at the end where a gear is looked
 * for. Four evenly spaced icons in a row would be four separate decisions to
 * make.
 *
 * Rescan All sits beside Refresh but is drawn as an eraser, so the dangerous
 * one of the pair is never the one you meant to click.
 */
export default function AppBar({
  firstName,
  query,
  onQuery,
  searchRef,
  design,
  onDesign,
  disconnected,
  syncing,
  onRefresh,
  onRescan,
  onSettings,
}: {
  firstName: string | null;
  query: string;
  onQuery: (value: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  design: Design;
  onDesign: (design: Design) => void;
  disconnected: boolean;
  syncing: boolean;
  onRefresh: () => void;
  onRescan: () => void;
  onSettings: () => void;
}) {
  return (
    <header className="appbar">
      <p className="appbar__brand">Welcome back, {firstName ?? "there"}</p>

      <div className="searchbar">
        <Search className="lucide searchbar__icon" />
        <input
          ref={searchRef}
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search Companies, Roles, or Emails"
          aria-label="Search Applications"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
        <kbd className="searchbar__kbd">/</kbd>
      </div>

      <div className="appbar__tools">
        <div className="appbar__group">
          <button
            className={`icon-btn${syncing ? " is-spinning" : ""}`}
            type="button"
            aria-label="Refresh"
            title={disconnected ? "Not Connected" : "Refresh"}
            disabled={disconnected || syncing}
            onClick={onRefresh}
          >
            <RefreshCw className="lucide" />
          </button>
          <button
            className="icon-btn icon-btn--danger"
            type="button"
            aria-label="Rescan All"
            title={disconnected ? "Not Connected" : "Rescan All"}
            disabled={disconnected || syncing}
            onClick={onRescan}
          >
            <Eraser className="lucide" />
          </button>
        </div>

        <span className="appbar__rule" aria-hidden="true" />

        <div className="appbar__group">
          {/* Swaps the two designs. The icon is the one being switched to, not
              the one on screen, because a toggle showing its own state reads as
              a button that would set it. */}
          <button
            className="icon-btn"
            type="button"
            aria-pressed={design === "sheet"}
            aria-label={design === "board" ? "Switch to Sheet View" : "Switch to Split View"}
            title={design === "board" ? "Sheet View" : "Split View"}
            onClick={() => onDesign(design === "board" ? "sheet" : "board")}
          >
            {design === "board" ? <Table className="lucide" /> : <Columns2 className="lucide" />}
          </button>
          <button
            className="icon-btn"
            type="button"
            aria-label="Settings"
            title="Settings"
            onClick={onSettings}
          >
            <Settings className="lucide" />
          </button>
        </div>
      </div>
    </header>
  );
}
