"use client";

import {
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock,
  CornerDownRight,
  Ellipsis,
  Eye,
  EyeOff,
  List,
  Mail,
  RotateCcw,
} from "lucide-react";
import Highlight from "./Highlight";
import MenuItem from "./MenuItem";
import { SECTIONS, formatDate, type ApplicationView, type EmailView } from "@/lib/view";
import { OUTCOME_LABELS, STAGE_LABELS, STATUSES, STATUS_LABELS, type Status } from "@/lib/constants";

/** The anchor itself, which a parent line and a child line draw identically. */
function EmailAnchor({
  email,
  query,
  icon: Icon,
}: {
  email: EmailView;
  query: string;
  icon: React.ElementType;
}) {
  return (
    <a href={email.href} target="_blank" rel="noopener noreferrer">
      <Icon className="lucide" />
      <span className="email__title">
        <Highlight text={email.title} query={query} />
      </span>
      <span className="email__date">{formatDate(email.date)}</span>
    </a>
  );
}

/**
 * One line of a drawer, and the lines shown under it. The tree is one level
 * deep by construction, so this renders children directly rather than calling
 * itself: a grandchild has no meaning to draw.
 *
 * A nested line carries no chip saying what kind of report it is. The title
 * already says it, and a notice sent three times reads as three identical
 * lines, which is exactly what happened.
 */
function EmailLine({ email, query }: { email: EmailView; query: string }) {
  return (
    <li className="email">
      <EmailAnchor email={email} query={query} icon={Mail} />
      {email.children.length ? (
        <ul className="emails emails--nested">
          {email.children.map((child) => (
            <li className="email email--child" key={child.id}>
              <EmailAnchor email={child} query={query} icon={CornerDownRight} />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

const SECTION_ICONS: Record<Status, React.ElementType> = {
  ACCEPTED: CircleCheck,
  IN_PROGRESS: Clock,
  APPLIED: List,
  REJECTED: Ban,
};

export type Row = { app: ApplicationView; viaEmail: boolean };

type BoardProps = {
  rows: Row[];
  totals: Record<Status, number>;
  query: string;
  open: Set<number>;
  collapsed: Set<Status>;
  menuFor: number | null;
  onToggleRow: (id: number) => void;
  onToggleSection: (key: Status) => void;
  onToggleMenu: (id: number | null) => void;
  onHide: (application: ApplicationView, hidden: boolean) => void;
  onSetStatus: (application: ApplicationView, status: Status | null) => void;
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
}: {
  application: ApplicationView;
  open: boolean;
  query: string;
  menuOpen: boolean;
  onToggleRow: (id: number) => void;
  onToggleMenu: (id: number | null) => void;
  onHide: (application: ApplicationView, hidden: boolean) => void;
  onSetStatus: (application: ApplicationView, status: Status | null) => void;
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
            {/* Which ending it was. The section already says the row is closed,
                so this says the one thing the section cannot: whether the
                employer turned it down, whether the applicant walked away, or
                whether an offer was taken back. */}
            {application.outcome ? (
              <span className="tag tag--outcome">{OUTCOME_LABELS[application.outcome]}</span>
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

        <div className="item__menu-wrap">
          <button
            className="item__menu-btn"
            type="button"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            aria-label="Row Options"
            onClick={(event) => {
              event.stopPropagation();
              onToggleMenu(menuOpen ? null : application.id);
            }}
          >
            <Ellipsis className="lucide" />
          </button>

          {menuOpen ? (
            <div className="menu" role="menu" onClick={(event) => event.stopPropagation()}>
              <button
                className="menu__item"
                role="menuitem"
                onClick={() => onHide(application, !application.isHidden)}
              >
                {application.isHidden ? (
                  <Eye className="lucide" style={{ opacity: 1 }} />
                ) : (
                  <EyeOff className="lucide" style={{ opacity: 1 }} />
                )}
                {application.isHidden ? "Show on the Board" : "Hide This Row"}
              </button>

              <p className="menu__label menu__label--sep">Set Status</p>
              {STATUSES.map((status) => (
                <MenuItem
                  key={status}
                  role="menuitemradio"
                  checked={application.statusOverride === status}
                  onClick={() => onSetStatus(application, status)}
                >
                  {STATUS_LABELS[status]}
                </MenuItem>
              ))}
              <div className="menu__foot">
                <button className="menu__clear" type="button" onClick={() => onSetStatus(application, null)}>
                  <RotateCcw className="lucide" />
                  Set Automatically from Emails
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="item__drawer">
        <div>
          <ul className="emails">
            {application.emails.length ? (
              application.emails.map((email) => (
                <EmailLine key={email.id} email={email} query={query} />
              ))
            ) : (
              <li className="email__none">No Emails Yet.</li>
            )}
          </ul>
        </div>
      </div>
    </li>
  );
}
