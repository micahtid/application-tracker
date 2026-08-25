"use client";

import { CornerDownRight, Mail } from "lucide-react";
import Highlight from "./Highlight";
import { formatDate, type EmailView } from "@/lib/view";

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

/**
 * Every email an application owns, as one drawer shows them.
 *
 * Both designs open the same drawer under a row, so the list lives here rather
 * than once inside each of them. Only the box around it differs: the board
 * grows the row, the sheet grows a cell that spans the table.
 */
export default function EmailList({
  emails,
  query,
}: {
  emails: EmailView[];
  query: string;
}) {
  return (
    <ul className="emails">
      {emails.length ? (
        emails.map((email) => <EmailLine key={email.id} email={email} query={query} />)
      ) : (
        <li className="email__none">No Emails Yet.</li>
      )}
    </ul>
  );
}
