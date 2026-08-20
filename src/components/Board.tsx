"use client";

import {
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock,
  Ellipsis,
  Eye,
  EyeOff,
  List,
  Mail,
  RotateCcw,
} from "lucide-react";
import Highlight from "./Highlight";
import { SECTIONS, formatDate, type ApplicationView } from "@/lib/view";
import { STATUSES, type Status } from "@/lib/constants";

const SECTION_ICONS: Record<Status, React.ElementType> = {
  ACCEPTED: CircleCheck,
  IN_PROGRESS: Clock,
  APPLIED: List,
  REJECTED: Ban,
};

const STATUS_LABELS: Record<Status, string> = {
  ACCEPTED: "Accepted",
  IN_PROGRESS: "In Progress",
  APPLIED: "Applied",
  REJECTED: "Rejected",
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
  return (
    <div className="board" id="board">
      {SECTIONS.map((section, index) => {
        const rows = props.rows.filter(({ app }) => app.status === section.key);
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
              <span className="tag tag--override" title="Status set by hand">
                <Check className="lucide" />
                {STATUS_LABELS[application.statusOverride]}
              </span>
            ) : null}
            {application.status === "IN_PROGRESS" && application.stageDetail ? (
              <span className="tag tag--stage">
                {application.stageDetail === "ASSESSMENT" ? "Assessment" : "Interview"}
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
            aria-label="Row options"
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
                {application.isHidden ? "Show on the board" : "Hide this row"}
              </button>

              <p className="menu__label menu__label--sep">Set Status</p>
              {STATUSES.map((status) => (
                <button
                  key={status}
                  className="menu__item"
                  role="menuitemradio"
                  aria-checked={application.statusOverride === status}
                  onClick={() => onSetStatus(application, status)}
                >
                  <Check className="lucide" />
                  {STATUS_LABELS[status]}
                </button>
              ))}
              <div className="menu__foot">
                <button className="menu__clear" type="button" onClick={() => onSetStatus(application, null)}>
                  <RotateCcw className="lucide" />
                  Auto, from the emails
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
                <li className="email" key={email.id}>
                  <a href={email.href} target="_blank" rel="noopener noreferrer">
                    <Mail className="lucide" />
                    <span className="email__title">
                      <Highlight text={email.title} query={query} />
                    </span>
                    <span className="email__date">{formatDate(email.date)}</span>
                  </a>
                </li>
              ))
            ) : (
              <li className="email__none">No emails yet.</li>
            )}
          </ul>
        </div>
      </div>
    </li>
  );
}
