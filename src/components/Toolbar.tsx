"use client";

import { useRef } from "react";
import { ArrowUpDown, Check, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { SORTS, type SortKey } from "@/lib/view";
import { SEASONS } from "@/lib/constants";
import { useDismissOnOutsideClick } from "@/lib/hooks";

type ToolbarProps = {
  query: string;
  sort: SortKey;
  filters: { season: Set<string>; year: Set<string> };
  years: number[];
  openMenu: "sort" | "filter" | null;
  onQuery: (value: string) => void;
  onSort: (value: SortKey) => void;
  onToggleFilter: (group: "season" | "year", value: string) => void;
  onClearFilters: () => void;
  onOpenMenu: (menu: "sort" | "filter" | null) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
};

export default function Toolbar(props: ToolbarProps) {
  const activeFilters = props.filters.season.size + props.filters.year.size;
  const wrapRef = useRef<HTMLDivElement>(null);

  // Clicking anywhere else closes whichever menu is open.
  useDismissOnOutsideClick(Boolean(props.openMenu), () => props.onOpenMenu(null));

  return (
    <div className="toolbar reveal" style={{ "--i": 1 } as React.CSSProperties} ref={wrapRef}>
      <div className="field">
        <Search className="lucide field__icon" />
        <input
          ref={props.searchRef}
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
        <div className="menu-wrap">
          <button
            className="ctrl"
            type="button"
            aria-haspopup="true"
            aria-expanded={props.openMenu === "sort"}
            onClick={(event) => {
              event.stopPropagation();
              props.onOpenMenu(props.openMenu === "sort" ? null : "sort");
            }}
          >
            <ArrowUpDown className="lucide" />
            <span>Sort</span>
          </button>

          {props.openMenu === "sort" ? (
            <div className="menu" role="menu" onClick={(event) => event.stopPropagation()}>
              <p className="menu__label">Sort By</p>
              {SORTS.map((option) => (
                <button
                  key={option.key}
                  className="menu__item"
                  role="menuitemradio"
                  aria-checked={props.sort === option.key}
                  onClick={() => props.onSort(option.key)}
                >
                  <Check className="lucide" />
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="menu-wrap">
          <button
            className="ctrl"
            type="button"
            aria-haspopup="true"
            aria-expanded={props.openMenu === "filter"}
            onClick={(event) => {
              event.stopPropagation();
              props.onOpenMenu(props.openMenu === "filter" ? null : "filter");
            }}
          >
            <SlidersHorizontal className="lucide" />
            <span>Filter</span>
            {activeFilters ? <span className="ctrl__count">{activeFilters}</span> : null}
          </button>

          {props.openMenu === "filter" ? (
            <div className="menu menu--wide" role="menu" onClick={(event) => event.stopPropagation()}>
              <p className="menu__label">Term</p>
              {SEASONS.map((season) => (
                <button
                  key={season}
                  className="menu__item"
                  role="menuitemcheckbox"
                  aria-checked={props.filters.season.has(season)}
                  onClick={() => props.onToggleFilter("season", season)}
                >
                  <Check className="lucide" />
                  {season}
                </button>
              ))}

              <p className="menu__label menu__label--sep">Year</p>
              {props.years.length ? (
                props.years.map((year) => (
                  <button
                    key={year}
                    className="menu__item"
                    role="menuitemcheckbox"
                    aria-checked={props.filters.year.has(String(year))}
                    onClick={() => props.onToggleFilter("year", String(year))}
                  >
                    <Check className="lucide" />
                    {year}
                  </button>
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
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
