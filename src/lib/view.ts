import {
  OUTCOME_LABELS,
  STATUSES,
  STATUS_LABELS,
  hasEnded,
  type Outcome,
  type StageDetail,
  type Status,
} from "@/lib/constants";

/** The board's shape, as the browser sees it. */
export type EmailView = {
  id: number;
  title: string;
  date: string;
  href: string;
  /** REPEAT | REMINDER | UPDATE, or null on an email that holds its own line. */
  relation: "REPEAT" | "REMINDER" | "UPDATE" | null;
  /** Always present, often empty, and never nested further. */
  children: EmailView[];
};

export type ApplicationView = {
  id: number;
  company: string;
  role: string | null;
  /**
   * The term the emails stated, in their words, and null when none does.
   * `season` beside it is the bucket the board files that term under, which is
   * null whenever the term fits none of them.
   */
  term: string | null;
  season: string | null;
  year: number | null;
  status: Status;
  statusOverride: Status | null;
  stageDetail: StageDetail | null;
  /** Which ending a finished application reached, or null when it has not ended. */
  outcome: Outcome | null;
  /**
   * True when nothing has arrived for a season and the row has not ended.
   * Worked out on every read from the date rather than stored, because it
   * changes with the calendar rather than with the mail.
   */
  isStale: boolean;
  isHidden: boolean;
  latestEmailAt: string | null;
  firstEmailAt: string | null;
  atsVendor: string | null;
  emails: EmailView[];
};

/**
 * What an application that has ended says it ended as, and null while it is
 * still running.
 *
 * `status` says one word for several facts. ACCEPTED covers an offer extended,
 * accepted, declined and taken back, and REJECTED covers being turned down,
 * withdrawing, and a posting cancelled. So an offer nobody had answered read
 * Accepted, the strongest word on the board, and a withdrawal read Rejected.
 *
 * Nothing new is stored to fix that. `outcome` is already written on every row
 * and read by nothing, and `OUTCOME_LABELS` holds every word this needs. A
 * row that ended carrying no outcome reads Application Closed, which is what
 * the schema already says that state is for.
 *
 * `status` keeps its own job of ordering and sectioning, because four buckets
 * is what a board needs and seven endings is not a set of columns.
 */
export function endingLabel(application: {
  status: Status;
  outcome: Outcome | null;
}): string | null {
  if (!hasEnded(application.status)) return null;
  return application.outcome ? OUTCOME_LABELS[application.outcome] : "Application Closed";
}

/** Board order, written out rather than derived, so it cannot move by accident. */
export const SECTIONS: { key: Status; label: string; modifier: string }[] = [
  { key: "ACCEPTED", label: STATUS_LABELS.ACCEPTED, modifier: "accepted" },
  { key: "IN_PROGRESS", label: STATUS_LABELS.IN_PROGRESS, modifier: "progress" },
  { key: "APPLIED", label: STATUS_LABELS.APPLIED, modifier: "applied" },
  { key: "REJECTED", label: STATUS_LABELS.REJECTED, modifier: "rejected" },
];

/** The class a status is drawn in, which is the one its section wears. */
export const STATUS_MODIFIERS = Object.fromEntries(
  SECTIONS.map((section) => [section.key, section.modifier]),
) as Record<Status, string>;

export const SORTS = [
  { key: "company-asc", label: "Company · A to Z" },
  { key: "company-desc", label: "Company · Z to A" },
  { key: "status", label: "Status" },
  { key: "recent", label: "Last Activity" },
  { key: "emails", label: "Most Emails" },
] as const;

export type SortKey = (typeof SORTS)[number]["key"];

/**
 * Which design the rows are drawn in. Nothing else differs between the two:
 * the search, the sort, the filters and the row menu are all the same, and a
 * row left open in one is still open in the other.
 */
export const DESIGNS = ["board", "sheet"] as const;
export type Design = (typeof DESIGNS)[number];

/** One line on screen, and whether the search reached it through an email. */
export type Row = { app: ApplicationView; viaEmail: boolean };

/** Everything a row needs from whichever design is drawing it. */
export type RowHandlers = {
  query: string;
  open: Set<number>;
  menuFor: number | null;
  onToggleRow: (id: number) => void;
  onToggleMenu: (id: number | null) => void;
  onHide: (application: ApplicationView, hidden: boolean) => void;
  onSetStatus: (application: ApplicationView, status: Status | null) => void;
};

/** A set with the value removed if it was there, added if it was not. */
export function toggled<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}

/** Dates are stored in UTC and shown in whatever zone the browser reports. */
export function formatDate(value: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function matchQuery(application: ApplicationView, query: string) {
  if (!query) return { hit: true, viaEmail: false };
  const needle = query.toLowerCase();

  // The term as the emails stated it, because that is the word on screen and
  // the word a reader will type. The bucket is a filter rather than a label.
  const header = [application.company, application.role, application.term, application.year]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const inHeader = header.includes(needle);
  // Every line the drawer shows, at either level. A hit on a nested line still
  // opens the row, because the row is where the reader will go looking for it.
  const inEmails = application.emails
    .flatMap((email) => [email, ...email.children])
    .some((email) => email.title.toLowerCase().includes(needle));

  // When the only match is inside an email title, that row opens itself so the
  // hit is visible.
  return { hit: inHeader || inEmails, viaEmail: inEmails && !inHeader };
}

export function passesFilters(
  application: ApplicationView,
  filters: { season: Set<string>; year: Set<string> },
): boolean {
  const seasonOk = !filters.season.size || (application.season && filters.season.has(application.season));
  const yearOk = !filters.year.size || (application.year && filters.year.has(String(application.year)));
  return Boolean(seasonOk && yearOk);
}

export function sortApplications(
  applications: ApplicationView[],
  sort: SortKey,
): ApplicationView[] {
  const byCompany = (a: ApplicationView, b: ApplicationView) => a.company.localeCompare(b.company);

  return [...applications].sort((a, b) => {
    switch (sort) {
      case "company-asc":
        return byCompany(a, b);
      case "company-desc":
        return byCompany(b, a);
      case "status":
        // Board order, so sorting by status in the sheet lays the rows out in
        // the order the board would have drawn its sections.
        return STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || byCompany(a, b);
      case "emails":
        // Top level lines only, so a long exchange about one step cannot
        // outrank a row that really reached more of them.
        return b.emails.length - a.emails.length || byCompany(a, b);
      default:
        return (b.latestEmailAt ?? "").localeCompare(a.latestEmailAt ?? "") || byCompany(a, b);
    }
  });
}
