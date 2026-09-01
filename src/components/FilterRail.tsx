"use client";

import { Fragment } from "react";
import { RotateCcw, Square, SquareCheck } from "lucide-react";
import type { FilterKey, Filters } from "@/lib/view";

/** One tickable line in the rail, with how many rows carry it. */
export type FilterOption = { value: string; label: string; count: number };

/** A titled run of them: Term, then Year. */
export type FilterGroup = {
  group: FilterKey;
  label: string;
  options: FilterOption[];
  /** What to say when the board holds nothing to filter by yet. */
  emptyLabel: string;
};

/**
 * The filters, and the state of the board underneath them.
 *
 * They sit down the left edge rather than behind a popover, because on a
 * screen this wide there is room to show which ones are on without being asked,
 * and a filter you cannot see is a filter you forget you set. Each line carries
 * the count it would leave, so choosing one is not a guess.
 *
 * On a narrow screen the rail lies down and scrolls sideways above the list.
 * Every control stays reachable; only the two lines of prose at the end drop
 * out, and the count they carry is already in the heading over the list.
 */
export default function FilterRail({
  groups,
  filters,
  shown,
  total,
  narrowed,
  hiddenCount,
  showHidden,
  onToggleFilter,
  onClearFilters,
  onToggleHidden,
}: {
  groups: FilterGroup[];
  filters: Filters;
  shown: number;
  total: number;
  narrowed: boolean;
  hiddenCount: number;
  showHidden: boolean;
  onToggleFilter: (group: FilterKey, value: string) => void;
  onClearFilters: () => void;
  onToggleHidden: () => void;
}) {
  const active = filters.season.size + filters.year.size;

  return (
    <nav className="rail" aria-label="Filters">
      {groups.map((group) => (
        <Fragment key={group.group}>
          <p className="rail__label">{group.label}</p>
          {group.options.length ? (
            group.options.map((option) => {
              const on = filters[group.group].has(option.value);
              return (
                <button
                  key={option.value}
                  className={`filter${on ? " is-on" : ""}`}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => onToggleFilter(group.group, option.value)}
                >
                  {/* Outlined when idle, filled when on, which is how a tick
                      box says which it is without a colour of its own. */}
                  {on ? <SquareCheck className="lucide" /> : <Square className="lucide" />}
                  <span className="textline">
                    <span className="filter__text">{option.label}</span>
                    <span className="filter__count">{option.count}</span>
                  </span>
                </button>
              );
            })
          ) : (
            <p className="rail__none">{group.emptyLabel}</p>
          )}
        </Fragment>
      ))}

      {active ? (
        <button className="rail__clear" type="button" onClick={onClearFilters}>
          <RotateCcw className="lucide" />
          Clear Filters
        </button>
      ) : null}

      {hiddenCount ? (
        <button className="rail__hidden" type="button" onClick={onToggleHidden}>
          {showHidden ? "Hide Them Again" : `${hiddenCount} Hidden`}
        </button>
      ) : null}

      <p className="rail__note">
        {/* Always connected. While it is not, the blank state stands in place
            of the whole layout and there is no rail to read this on. */}
        <span>Gmail Connected</span>
        <span>
          {shown} of {total} applications {narrowed ? "shown" : "tracked"}
        </span>
      </p>
    </nav>
  );
}
