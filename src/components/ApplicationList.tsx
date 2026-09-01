"use client";

import { useRef } from "react";
import { ArrowUpDown, ChevronDown } from "lucide-react";
import Highlight from "./Highlight";
import MenuItem from "./MenuItem";
import NoResults from "./NoResults";
import PaneHead from "./PaneHead";
import SplitHandle from "./SplitHandle";
import { STATUS_ICONS } from "./StatusIcon";
import {
  SECTIONS,
  SORTS,
  SORT_LABELS,
  STATUS_MODIFIERS,
  formatAge,
  type ApplicationView,
  type Row,
  type SortKey,
} from "@/lib/view";
import { STATUSES, type Status } from "@/lib/constants";
import { useDismissOnOutsideClick } from "@/lib/hooks";

type ApplicationListProps = {
  rows: Row[];
  /** How many rows each section holds before the search and the filters. */
  totals: Record<Status, number>;
  /** How many the board holds in all, for the count over the list. */
  total: number;
  collapsed: Set<Status>;
  picked: number | null;
  query: string;
  narrowed: boolean;
  loaded: boolean;
  sort: SortKey;
  sortOpen: boolean;
  /** The width the divider has been dragged to, and null at its default. */
  width: number | null;
  onToggleSection: (key: Status) => void;
  onPick: (id: number) => void;
  onSort: (value: SortKey) => void;
  onOpenSort: (open: boolean) => void;
  onWidth: (px: number | null) => void;
};

/**
 * The left hand pane of the split view: every row that survived the search and
 * the filters, under the board's four status headings.
 *
 * A line here carries only what tells one row from another at a glance, which
 * is the company, the role and how long it has been quiet. Everything else the
 * board used to hang off the row now has a whole pane to be read in, so the
 * list stays a list.
 */
export default function ApplicationList({
  rows,
  totals,
  total,
  collapsed,
  picked,
  query,
  narrowed,
  loaded,
  sort,
  sortOpen,
  width,
  onToggleSection,
  onPick,
  onSort,
  onOpenSort,
  onWidth,
}: ApplicationListProps) {
  const paneRef = useRef<HTMLElement>(null);

  // Clicking anywhere else closes the sort menu.
  useDismissOnOutsideClick(sortOpen, () => onOpenSort(false));

  // One pass fills every section, rather than one pass over the whole board
  // for each of the four.
  const bySection = new Map<Status, Row[]>(STATUSES.map((status) => [status, []]));
  for (const row of rows) bySection.get(row.app.status)?.push(row);

  return (
    <section className="pane pane--list" aria-label="Applications" ref={paneRef}>
      <PaneHead shown={rows.length} total={total}>
        <div className="menu-wrap">
          <button
            className="ctrl ctrl--compact"
            type="button"
            aria-haspopup="true"
            aria-expanded={sortOpen}
            onClick={(event) => {
              event.stopPropagation();
              onOpenSort(!sortOpen);
            }}
          >
            <ArrowUpDown className="lucide" />
            <span>{SORT_LABELS[sort]}</span>
          </button>

          {sortOpen ? (
            <div className="menu" role="menu" onClick={(event) => event.stopPropagation()}>
              <p className="menu__label">Sort By</p>
              {SORTS.map((option) => (
                <MenuItem
                  key={option.key}
                  role="menuitemradio"
                  checked={sort === option.key}
                  onClick={() => {
                    onSort(option.key);
                    onOpenSort(false);
                  }}
                >
                  {option.label}
                </MenuItem>
              ))}
            </div>
          ) : null}
        </div>
      </PaneHead>

      <div className="pane__body list">
        {rows.length
          ? SECTIONS.map((section) => {
              const inSection = bySection.get(section.key) ?? [];
              if (!inSection.length) return null;

              const shut = collapsed.has(section.key);
              const held = totals[section.key];
              const Icon = STATUS_ICONS[section.key];

              return (
                <section
                  key={section.key}
                  className={`section section--${section.modifier}${shut ? " is-collapsed" : ""}`}
                >
                  <h3>
                    <button
                      className="section__head"
                      type="button"
                      aria-expanded={!shut}
                      onClick={() => onToggleSection(section.key)}
                    >
                      <Icon className="lucide section__icon" />
                      <span className="textline">
                        <span className="section__title">{section.label}</span>
                        <span className="section__count">
                          {inSection.length === held ? held : `${inSection.length} / ${held}`}
                        </span>
                      </span>
                      <ChevronDown className="lucide section__fold" />
                    </button>
                  </h3>

                  {/* A shut section leaves the DOM rather than being hidden in
                      it, because its heading sticks to the top of the list as
                      you scroll and cannot also be the lid on a box that is
                      animating shut underneath it. */}
                  {shut ? null : (
                    <ul>
                      {inSection.map(({ app }) => (
                        <li key={app.id}>
                          <ApplicationLine
                            application={app}
                            picked={app.id === picked}
                            query={query}
                            onPick={onPick}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })
          : null}

        {loaded && !rows.length ? <NoResults query={query} narrowed={narrowed} /> : null}
      </div>

      <SplitHandle width={width} paneRef={paneRef} onWidth={onWidth} />
    </section>
  );
}

/**
 * One line. The dot repeats the section's own colour, which is what keeps the
 * status readable once a heading has scrolled up out of sight.
 */
function ApplicationLine({
  application,
  picked,
  query,
  onPick,
}: {
  application: ApplicationView;
  picked: boolean;
  query: string;
  onPick: (id: number) => void;
}) {
  return (
    <button
      className={`row${picked ? " is-picked" : ""}${application.isHidden ? " is-hidden" : ""}`}
      type="button"
      aria-current={picked ? "true" : undefined}
      onClick={() => onPick(application.id)}
    >
      <span className={`row__dot row__dot--${STATUS_MODIFIERS[application.status]}`} aria-hidden="true" />
      <span className="row__body">
        <span className="textline">
          <span className="row__company">
            <Highlight text={application.company} query={query} />
          </span>
          <span className="row__age">{formatAge(application.latestEmailAt)}</span>
        </span>
        <span className="row__role">
          {application.role ? (
            <Highlight text={application.role} query={query} />
          ) : (
            "No Role Stated"
          )}
        </span>
      </span>
    </button>
  );
}
