"use client";

import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
} from "lucide-react";
import EmailList from "./EmailList";
import Highlight from "./Highlight";
import NoResults from "./NoResults";
import PaneHead from "./PaneHead";
import RowMenu from "./RowMenu";
import {
  STALE_NOTE,
  STATUS_MODIFIERS,
  endingLabel,
  formatDate,
  stageLabel,
  type ApplicationView,
  type Row,
  type RowActions,
  type RowDrawers,
  type SortKey,
} from "@/lib/view";
import { STATUS_LABELS } from "@/lib/constants";

/**
 * The second design: one flat grid, the way most people track applications
 * before they find an app for it.
 *
 * The split view groups by status and reads one row at a time in a pane of its
 * own. A sheet does the opposite: every row is one line and every fact has a
 * column, so a status is a cell like any other and the mail opens out under
 * the line rather than beside it.
 *
 * The button in the app bar swaps between them, and the styling lives under
 * .sheet in globals.css. Everything around the grid is shared: the same app
 * bar, the same filter rail, the same pane head, the same row menu.
 *
 * No cell can be edited. A cell here is a fact read out of an email, and
 * typing over one would put a fact on screen that no email supports. The row
 * menu still sets a status by hand, because that is the one place that
 * records it was set by hand.
 */

/** Which sort keys a column's heading cycles through, in the order it cycles. */
type Column = {
  key: string;
  label: string;
  /** Empty on a column nothing can be sorted by, which is most of them. */
  sorts: SortKey[];
};

const COLUMNS: Column[] = [
  { key: "company", label: "Company", sorts: ["company-asc", "company-desc"] },
  { key: "role", label: "Role", sorts: [] },
  { key: "status", label: "Status", sorts: ["status"] },
  { key: "stage", label: "Stage", sorts: [] },
  { key: "term", label: "Term", sorts: [] },
  { key: "year", label: "Year", sorts: [] },
  { key: "emails", label: "Emails", sorts: ["emails"] },
  { key: "applied", label: "Applied", sorts: [] },
  { key: "activity", label: "Last Activity", sorts: ["recent"] },
];

/** What a drawer spans: every column, plus the menu that has no heading. */
const DRAWER_SPAN = COLUMNS.length + 1;

/**
 * Which way the arrow on a sorted heading points. A to Z is the only sort
 * that runs upward; the other three put the largest first.
 */
const ASCENDING: SortKey = "company-asc";

/**
 * The one line the Stage column holds. A row has at most one of these to say,
 * so a step and an ending share a column rather than each taking one that is
 * empty on almost every row. An ending wins, because a step still in flight
 * when the answer came stopped being the news.
 *
 * Both halves come from `@/lib/view`, which is where the reading pane asks for
 * them too, so the two designs cannot say two different things about one row.
 * `endingLabel` returns null for the endings the Rejected section already
 * covers, and this column is empty on those rows too.
 */
function stageCell(application: ApplicationView): string {
  return endingLabel(application) ?? stageLabel(application) ?? "";
}

export default function Sheet({
  rows,
  total,
  query,
  narrowed,
  loaded,
  sort,
  onSort,
  open,
  onToggleRow,
  onToggleAll,
  ...actions
}: RowActions &
  RowDrawers & {
    rows: Row[];
    /** How many the board holds in all, for the count over the grid. */
    total: number;
    query: string;
    narrowed: boolean;
    loaded: boolean;
    sort: SortKey;
    onSort: (value: SortKey) => void;
    /** Opens every drawer at once, or shuts every one that is open. */
    onToggleAll: () => void;
  }) {
  return (
    <section className="pane pane--sheet" aria-label="Applications">
      <PaneHead shown={rows.length} total={total}>
        {rows.length ? (
          <button className="ctrl ctrl--compact" type="button" onClick={onToggleAll}>
            {open.size ? (
              <ChevronsDownUp className="lucide" />
            ) : (
              <ChevronsUpDown className="lucide" />
            )}
            <span>{open.size ? "Collapse All" : "Expand All"}</span>
          </button>
        ) : null}
      </PaneHead>

      <div className="pane__body sheet">
        {rows.length ? (
          <table className="sheet__grid">
            <thead>
              <tr>
                <th className="sheet__gutter" scope="col">
                  <span className="sr-only">Row</span>
                </th>
                {COLUMNS.map((column) => (
                  <SheetHead key={column.key} column={column} sort={sort} onSort={onSort} />
                ))}
                <th className="sheet__menu" scope="col">
                  <span className="sr-only">Row Options</span>
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.map(({ app, viaEmail }, index) => (
                <SheetRow
                  key={app.id}
                  application={app}
                  number={index + 1}
                  open={open.has(app.id) || viaEmail}
                  query={query}
                  onToggleRow={onToggleRow}
                  {...actions}
                />
              ))}
            </tbody>
          </table>
        ) : null}

        {loaded && !rows.length ? <NoResults query={query} narrowed={narrowed} /> : null}
      </div>
    </section>
  );
}

/**
 * A heading, and on the four that sort, the control that sorts by it. A click
 * walks that column's own list of sorts, so Company alternates between its two
 * directions and the other three simply select themselves.
 */
function SheetHead({
  column,
  sort,
  onSort,
}: {
  column: Column;
  sort: SortKey;
  onSort: (value: SortKey) => void;
}) {
  const at = column.sorts.indexOf(sort);
  const active = at !== -1;
  const Arrow = sort === ASCENDING ? ArrowUp : ArrowDown;

  return (
    <th
      scope="col"
      aria-sort={active ? (sort === ASCENDING ? "ascending" : "descending") : undefined}
    >
      {column.sorts.length ? (
        <button
          className={`sheet__sort${active ? " is-active" : ""}`}
          type="button"
          onClick={() => onSort(column.sorts[(at + 1) % column.sorts.length])}
        >
          {column.label}
          {active ? <Arrow className="lucide sheet__arrow" /> : null}
        </button>
      ) : (
        <span className="sheet__label">{column.label}</span>
      )}
    </th>
  );
}

function SheetRow({
  application,
  number,
  open,
  query,
  menuFor,
  onToggleRow,
  onToggleMenu,
  onHide,
  onSetStatus,
}: RowActions &
  Pick<RowDrawers, "onToggleRow"> & {
    application: ApplicationView;
    number: number;
    open: boolean;
    query: string;
  }) {
  const stage = stageCell(application);

  return (
    <>
      {/* The whole line answers a click, the way a row in a grid does. The
          menu cell stops its own clicks, so opening the menu does not also
          open the drawer under it. */}
      <tr
        className={`sheet__row${open ? " is-open" : ""}${
          application.isHidden ? " is-hidden" : ""
        }`}
        aria-expanded={open}
        tabIndex={0}
        onClick={() => onToggleRow(application.id)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onToggleRow(application.id);
        }}
      >
        <td className="sheet__gutter">{number}</td>

        <td className="sheet__company-cell">
          <span className="sheet__chevron">
            <ChevronRight className="lucide" />
          </span>
          <span className="sheet__company">
            <Highlight text={application.company} query={query} />
          </span>
        </td>

        {/* Cut short, because a role is the one cell with nothing bounding
            its length. */}
        <td>
          {application.role ? (
            <span className="sheet__role" title={application.role}>
              <Highlight text={application.role} query={query} />
            </span>
          ) : null}
        </td>

        {/* The reading pane's own tag, so the two designs say a status the same
            way. The tick beside it is that pane's override tag, cut down to the
            one mark a column has room for. */}
        <td>
          <span className={`tag tag--${STATUS_MODIFIERS[application.status]}`}>
            {STATUS_LABELS[application.status]}
          </span>
          {application.statusOverride ? (
            <Check
              className="lucide sheet__override"
              role="img"
              aria-label="Status Set Manually"
            />
          ) : null}
        </td>

        <td>{stage}</td>
        <td>{application.term ?? ""}</td>
        <td>{application.year ?? ""}</td>
        <td>{application.emails.length}</td>
        <td className="sheet__date">{formatDate(application.firstEmailAt)}</td>

        {/* Nothing has arrived for a season. Marked on the date, because the
            date is the cell the fact is about. */}
        <td
          className={`sheet__date${application.isStale ? " is-stale" : ""}`}
          title={application.isStale ? STALE_NOTE : undefined}
        >
          {formatDate(application.latestEmailAt)}
        </td>

        <td className="sheet__menu" onClick={(event) => event.stopPropagation()}>
          <RowMenu
            application={application}
            open={menuFor === application.id}
            onToggleMenu={onToggleMenu}
            onHide={onHide}
            onSetStatus={onSetStatus}
          />
        </td>
      </tr>

      {/* A row of its own spanning the grid, which is how a sheet shows a
          group opened out under its line. A closed drawer is left out of the
          table rather than hidden, so it cannot be tabbed into or read out. */}
      {open ? (
        <tr className="sheet__drawer-row">
          <td className="sheet__gutter" />
          <td className="sheet__drawer" colSpan={DRAWER_SPAN}>
            <EmailList emails={application.emails} query={query} />
          </td>
        </tr>
      ) : null}
    </>
  );
}
