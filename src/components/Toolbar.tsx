"use client";

import { ArrowUpDown, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import MenuItem from "./MenuItem";
import { SORTS, type SortKey } from "@/lib/view";
import { SEASONS } from "@/lib/constants";
import { useDismissOnOutsideClick } from "@/lib/hooks";

type MenuName = "sort" | "filter";

type ToolbarProps = {
  query: string;
  sort: SortKey;
  filters: { season: Set<string>; year: Set<string> };
  years: number[];
  openMenu: MenuName | null;
  onQuery: (value: string) => void;
  onSort: (value: SortKey) => void;
  onToggleFilter: (group: "season" | "year", value: string) => void;
  onClearFilters: () => void;
  onOpenMenu: (menu: MenuName | null) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
};

/**
 * One of the two toolbar controls: a button that opens a popover under itself.
 *
 * Sort and Filter are the same button, the same click handling and the same
 * panel, differing only in the icon, the label, whether a count rides on the
 * button, and what is inside the panel.
 */
function Control({
  name,
  icon: Icon,
  label,
  badge,
  open,
  wide,
  onOpen,
  children,
}: {
  name: MenuName;
  icon: React.ElementType;
  label: string;
  badge?: number;
  open: boolean;
  wide?: boolean;
  onOpen: (menu: MenuName | null) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="menu-wrap">
      <button
        className="ctrl"
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          onOpen(open ? null : name);
        }}
      >
        <Icon className="lucide" />
        <span>{label}</span>
        {badge ? <span className="ctrl__count">{badge}</span> : null}
      </button>

      {open ? (
        <div
          className={`menu${wide ? " menu--wide" : ""}`}
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export default function Toolbar(props: ToolbarProps) {
  // Taken off `props` here rather than read in place below. The hooks rules
  // treat anything reached through an object holding a ref as a ref itself, so
  // leaving it there had them reporting `props.query` as a ref read.
  const { searchRef } = props;
  const activeFilters = props.filters.season.size + props.filters.year.size;

  // Clicking anywhere else closes whichever menu is open.
  useDismissOnOutsideClick(Boolean(props.openMenu), () => props.onOpenMenu(null));

  return (
    <div className="toolbar reveal" style={{ "--i": 1 } as React.CSSProperties}>
      <div className="field">
        <Search className="lucide field__icon" />
        <input
          ref={searchRef}
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search Companies, Roles, or Emails…"
          aria-label="Search Applications"
          value={props.query}
          onChange={(event) => props.onQuery(event.target.value)}
        />
        <kbd className="field__kbd">/</kbd>
      </div>

      <div className="toolbar__controls">
        <Control
          name="sort"
          icon={ArrowUpDown}
          label="Sort"
          open={props.openMenu === "sort"}
          onOpen={props.onOpenMenu}
        >
          <p className="menu__label">Sort By</p>
          {SORTS.map((option) => (
            <MenuItem
              key={option.key}
              role="menuitemradio"
              checked={props.sort === option.key}
              onClick={() => props.onSort(option.key)}
            >
              {option.label}
            </MenuItem>
          ))}
        </Control>

        <Control
          name="filter"
          icon={SlidersHorizontal}
          label="Filter"
          badge={activeFilters}
          open={props.openMenu === "filter"}
          wide
          onOpen={props.onOpenMenu}
        >
          <p className="menu__label">Term</p>
          {SEASONS.map((season) => (
            <MenuItem
              key={season}
              role="menuitemcheckbox"
              checked={props.filters.season.has(season)}
              onClick={() => props.onToggleFilter("season", season)}
            >
              {season}
            </MenuItem>
          ))}

          <p className="menu__label menu__label--sep">Year</p>
          {props.years.length ? (
            props.years.map((year) => (
              <MenuItem
                key={year}
                role="menuitemcheckbox"
                checked={props.filters.year.has(String(year))}
                onClick={() => props.onToggleFilter("year", String(year))}
              >
                {year}
              </MenuItem>
            ))
          ) : (
            <p className="menu__label">No Years Yet</p>
          )}

          <div className="menu__foot">
            <button className="menu__clear" type="button" onClick={props.onClearFilters}>
              <RotateCcw className="lucide" />
              Clear Filters
            </button>
          </div>
        </Control>
      </div>
    </div>
  );
}
