"use client";

import { ArrowDown, ArrowUp, Check, ChevronRight } from "lucide-react";
import EmailList from "./EmailList";
import Highlight from "./Highlight";
import RowMenu from "./RowMenu";
import {
  endingLabel,
  formatDate,
  STATUS_MODIFIERS,
  type ApplicationView,
  type Row,
  type RowHandlers,
  type SortKey,
} from "@/lib/view";
import { STAGE_LABELS, STATUS_LABELS } from "@/lib/constants";

/**
 * The second design: one flat grid, the way most people track applications
 * before they find an app for it.
 *
 * The board groups by status and puts everything else in a drawer. A sheet
 * does the opposite: every row is one line and every fact has a column, so a
 * status is a cell like any other. The button in the masthead swaps between
 * them, and the styling lives under .sheet in globals.css.
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
 * The ending comes from `endingLabel`, which is the one rule for what a
 * finished row says, so the board and the sheet cannot say two different things
 * about one application. It used to hold back OFFER_EXTENDED, which left the
 * one ending the applicant still has to answer as the only one the board would
 * not name (LOOP5 Decision 5).
 */
function stageCell(application: ApplicationView): string {
  const ending = endingLabel(application);
  if (ending) return ending;
  if (application.status === "IN_PROGRESS" && application.stageDetail) {
    return STAGE_LABELS[application.stageDetail];
  }
  return "";
}

export default function Sheet({
  rows,
  sort,
  onSort,
  open,
  ...handlers
}: RowHandlers & {
  rows: Row[];
  sort: SortKey;
  onSort: (value: SortKey) => void;
}) {
  // Otherwise a grid of headings with nothing under them, sitting above the
  // line that already says nothing is tracked yet.
  if (!rows.length) return null;

  return (
    <div className="sheet">
      <div className="sheet__scroll">
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
                {...handlers}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
}: Omit<RowHandlers, "open"> & {
  application: ApplicationView;
  number: number;
  open: boolean;
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

        {/* The board's own tag, so the two designs say a status the same way.
            The tick beside it is the board's override tag, cut down to the
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
          title={
            application.isStale
              ? "Nothing has arrived on this application for a while"
              : undefined
          }
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
