"use client";

import { Ban, Check, ChevronDown, ChevronRight, CircleCheck, Clock, List } from "lucide-react";
import EmailList from "./EmailList";
import Highlight from "./Highlight";
import RowMenu from "./RowMenu";
import { SECTIONS, type ApplicationView, type Row, type RowHandlers } from "@/lib/view";
import { STAGE_LABELS, STATUSES, STATUS_LABELS, type Status } from "@/lib/constants";

const SECTION_ICONS: Record<Status, React.ElementType> = {
  ACCEPTED: CircleCheck,
  IN_PROGRESS: Clock,
  APPLIED: List,
  REJECTED: Ban,
};

type BoardProps = RowHandlers & {
  rows: Row[];
  totals: Record<Status, number>;
  collapsed: Set<Status>;
  onToggleSection: (key: Status) => void;
};

export default function Board(props: BoardProps) {
  // One pass fills every section, rather than one pass over the whole board
  // for each of the four.
  const bySection = new Map<Status, Row[]>(STATUSES.map((status) => [status, []]));
  for (const row of props.rows) bySection.get(row.app.status)?.push(row);

  return (
    <div className="board" id="board">
      {SECTIONS.map((section, index) => {
        const rows = bySection.get(section.key) ?? [];
        if (!rows.length) return null;

        const total = props.totals[section.key] ?? 0;
        const collapsed = props.collapsed.has(section.key);
        const Icon = SECTION_ICONS[section.key];

        return (
          <section
            key={section.key}
            className={`section section--${section.modifier}${collapsed ? " collapsed" : ""}`}
            style={{ "--i": index } as React.CSSProperties}
          >
            <button
              className="section__head"
              type="button"
              aria-expanded={!collapsed}
              onClick={() => props.onToggleSection(section.key)}
            >
              <Icon className="lucide section__icon" />
              <span className="section__title">{section.label}</span>
              <span className="section__count">
                {rows.length === total ? total : `${rows.length} / ${total}`}
              </span>
              <ChevronDown className="lucide section__fold" />
            </button>

            <div className="section__body">
              <ul>
                {rows.map(({ app, viaEmail }) => (
                  <ApplicationRow
                    key={app.id}
                    application={app}
                    open={props.open.has(app.id) || viaEmail}
                    query={props.query}
                    menuOpen={props.menuFor === app.id}
                    onToggleRow={props.onToggleRow}
                    onToggleMenu={props.onToggleMenu}
                    onHide={props.onHide}
                    onSetStatus={props.onSetStatus}
                  />
                ))}
              </ul>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ApplicationRow({
  application,
  open,
  query,
  menuOpen,
  onToggleRow,
  onToggleMenu,
  onHide,
  onSetStatus,
}: Omit<RowHandlers, "open" | "menuFor"> & {
  application: ApplicationView;
  open: boolean;
  menuOpen: boolean;
}) {
  return (
    <li
      className={`item${open ? " open" : ""}${application.isHidden ? " item--hidden" : ""}`}
      data-id={application.id}
    >
      <div className="item__head">
        <button
          className="item__row"
          type="button"
          aria-expanded={open}
          onClick={() => onToggleRow(application.id)}
        >
          <span className="item__chevron">
            <ChevronRight className="lucide" />
          </span>
          <span className="item__label">
            <span className="item__company">
              <Highlight text={application.company} query={query} />
            </span>
            {application.role ? (
              <>
                , <Highlight text={application.role} query={query} />
              </>
            ) : null}
          </span>
          <span className="tags">
            {application.statusOverride ? (
              <span className="tag tag--override" title="Status Set Manually">
                <Check className="lucide" />
                {STATUS_LABELS[application.statusOverride]}
              </span>
            ) : null}
            {application.status === "IN_PROGRESS" && application.stageDetail ? (
              <span className="tag tag--stage">
                {STAGE_LABELS[application.stageDetail]}
              </span>
            ) : null}
            {/* Nothing has arrived for a season. No email said so, and none
                ever will: it is a fact about the set rather than about any
                message. */}
            {application.isStale ? (
              <span className="tag tag--stale" title="Nothing has arrived on this application for a while">
                Quiet
              </span>
            ) : null}
            {application.season ? <span className="tag">{application.season}</span> : null}
            {application.year ? <span className="tag tag--year">{application.year}</span> : null}
          </span>
        </button>

        <RowMenu
          application={application}
          open={menuOpen}
          onToggleMenu={onToggleMenu}
          onHide={onHide}
          onSetStatus={onSetStatus}
        />
      </div>

      <div className="item__drawer">
        <div>
          <EmailList emails={application.emails} query={query} />
        </div>
      </div>
    </li>
  );
}
