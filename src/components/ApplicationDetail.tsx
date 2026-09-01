"use client";

import { ArrowLeft, Check } from "lucide-react";
import EmailList from "./EmailList";
import RowMenu from "./RowMenu";
import { STATUS_ICONS } from "./StatusIcon";
import {
  STALE_NOTE,
  STATUS_MODIFIERS,
  daysSince,
  endingLabel,
  formatDate,
  stageLabel,
  termLabel,
  type ApplicationView,
  type RowActions,
} from "@/lib/view";
import { STATUS_LABELS } from "@/lib/constants";
import { plural } from "@/lib/text";

/**
 * The right hand pane of the split view: one application, read out in full.
 *
 * It is where the board's row tags went. A row in the list had to say the
 * company, the role, the status, the step, the ending, the term, the year and
 * whether anything was still arriving, all on one line, and the line lost.
 * Here the badges have a header to sit in, the mail has a column of its own,
 * and the dates have a column beside it.
 *
 * On a screen too narrow to hold both panes it slides in over the list, and
 * Back or Escape sends it away again.
 */
export default function ApplicationDetail({
  application,
  query,
  menuFor,
  onBack,
  onToggleMenu,
  onHide,
  onSetStatus,
}: RowActions & {
  application: ApplicationView | null;
  query: string;
  onBack: () => void;
}) {
  if (!application) {
    return (
      <section className="pane pane--detail" aria-label="Application Detail">
        <p className="detail__blank">Pick an application on the left.</p>
      </section>
    );
  }

  const StatusIcon = STATUS_ICONS[application.status];
  const ending = endingLabel(application);
  const stage = stageLabel(application);
  const term = termLabel(application);
  const quiet = daysSince(application.latestEmailAt);

  return (
    <section className="pane pane--detail" aria-label="Application Detail" aria-live="polite">
      <button className="detail__back" type="button" onClick={onBack}>
        <ArrowLeft className="lucide" />
        Back
      </button>

      <div className="detail__inner">
        <header className="detail__head">
          <div className="detail__top">
            <div className="detail__names">
              <h2 className="detail__company">{application.company}</h2>
              <p className="detail__role">{application.role ?? "No Role Stated"}</p>
            </div>

            <RowMenu
              application={application}
              open={menuFor === application.id}
              onToggleMenu={onToggleMenu}
              onHide={onHide}
              onSetStatus={onSetStatus}
            />
          </div>

          {/* What the board used to fit onto the row itself. The term and the
              year are not here: they are facts about the posting rather than
              about where the application has got to, so they read below with
              the dates. */}
          <div className="tags">
            <span className={`tag tag--${STATUS_MODIFIERS[application.status]}`}>
              <StatusIcon className="lucide" />
              {STATUS_LABELS[application.status]}
            </span>
            {application.statusOverride ? (
              <span className="tag tag--override">
                <Check className="lucide" />
                Status Set Manually
              </span>
            ) : null}
            {/* Which ending a finished row reached, in its own words rather
                than left to the section heading, which has one word for several
                endings. The sheet's Stage column reads the same rule, so the
                two designs cannot disagree. */}
            {ending ? <span className="tag tag--ending">{ending}</span> : null}
            {stage ? <span className="tag tag--stage">{stage}</span> : null}
            {/* Nothing has arrived for a season. No email said so, and none
                ever will: it is a fact about the set rather than about any
                message. */}
            {application.isStale ? (
              <span className="tag tag--stale" title={STALE_NOTE}>
                Quiet
              </span>
            ) : null}
            {application.isHidden ? <span className="tag">Hidden</span> : null}
          </div>
        </header>

        <section className="detail__body">
          <h3 className="detail__label">Emails</h3>
          <EmailList emails={application.emails} query={query} />
        </section>

        {/* Beside the mail on a wide pane, above it on a narrow one. Only the
            lines this row has an answer for are drawn, because a label with a
            dash beside it says nothing a missing line does not.

            Nothing here repeats a tag above or the list beside it. The status,
            the step and the ending are badges in the header, and how many
            emails there are is the list itself. */}
        <aside className="detail__aside">
          <h3 className="detail__label">Details</h3>
          {term ? <Fact label="Term">{term}</Fact> : null}
          {application.firstEmailAt ? (
            <Fact label="Applied">{formatDate(application.firstEmailAt)}</Fact>
          ) : null}
          {application.latestEmailAt ? (
            <Fact label="Last Activity">
              {formatDate(application.latestEmailAt)}
              {/* Held together, so a narrow column wraps the whole phrase to
                  the next line rather than breaking it after "4 days". */}
              {quiet ? <span className="fact__ago"> ({plural(quiet, "Day")} Ago)</span> : null}
            </Fact>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

/** One labelled line of the details column: the label left, the answer right. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fact">
      <span className="fact__key">{label}</span>
      <span className="fact__value">{children}</span>
    </div>
  );
}
