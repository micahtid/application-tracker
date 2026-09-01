import {
  OUTCOME_LABELS,
  STAGE_LABELS,
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

/** Endings that get no word on the row. Both end up in the Rejected section,
 *  and the section heading is all the board says about them. */
const UNSAID_ENDINGS: Outcome[] = ["REJECTED_BY_EMPLOYER", "WITHDRAWN_BY_APPLICANT"];

/**
 * What an application that has ended says it ended as, and null while it is
 * still running or when the ending is one of `UNSAID_ENDINGS`.
 *
 * `status` says one word for several facts. ACCEPTED covers an offer extended,
 * accepted, declined and taken back, and REJECTED covers being turned down,
 * withdrawing, and a posting cancelled. So an offer nobody had answered read
 * Accepted, the strongest word on the board.
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
  if (application.outcome && UNSAID_ENDINGS.includes(application.outcome)) return null;
  return application.outcome ? OUTCOME_LABELS[application.outcome] : "Application Closed";
}

/**
 * The step a running application has reached, and null when it has reached
 * none or has already ended.
 *
 * The reading pane's badge and the sheet's Stage column both ask here, so the
 * two designs cannot end up saying different things about one row.
 */
export function stageLabel(application: {
  status: Status;
  stageDetail: StageDetail | null;
}): string | null {
  if (application.status !== "IN_PROGRESS" || !application.stageDetail) return null;
  return STAGE_LABELS[application.stageDetail];
}

/**
 * The term a row states with its year beside it, and null when it states
 * neither. The words the emails used rather than the bucket they are filed
 * under, so a row that says Winter says Winter.
 */
export function termLabel(application: {
  term: string | null;
  year: number | null;
}): string | null {
  if (application.term) {
    return application.year ? `${application.term} ${application.year}` : application.term;
  }
  return application.year ? String(application.year) : null;
}

/**
 * Why a row is marked quiet, said the same way in both designs: the reading
 * pane hangs it off the Quiet tag and the sheet off the date the tag is about.
 */
export const STALE_NOTE = "Nothing has arrived on this application for a while";

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

/** What the sort button says it is sorting by. A lookup, so a sort added
 *  above cannot leave the button naming one that is no longer there. */
export const SORT_LABELS = Object.fromEntries(
  SORTS.map((sort) => [sort.key, sort.label]),
) as Record<SortKey, string>;

/**
 * Which design the rows are drawn in. The search, the filters, the sorts and
 * the row menu are the same in both, and a status set by hand in one is set by
 * hand in the other.
 *
 * `board` is the split view: the four status sections as a list on the left,
 * and whichever row is picked read out in the pane on the right. `sheet` is
 * the same rows as one flat grid, with a drawer under each line that is open.
 */
export const DESIGNS = ["board", "sheet"] as const;
export type Design = (typeof DESIGNS)[number];

/** One line on screen, and whether the search reached it through an email. */
export type Row = { app: ApplicationView; viaEmail: boolean };

/**
 * The two things the rail narrows the board by, and what is ticked under each.
 * A row has to answer to every group that has anything ticked in it.
 */
export type FilterKey = "season" | "year";
export type Filters = Record<FilterKey, Set<string>>;

/**
 * What a row can be told to do, wherever its menu is drawn. The reading pane
 * puts it beside the company name and the sheet puts it at the end of a line,
 * and neither knows which one it is sitting in.
 */
export type RowActions = {
  menuFor: number | null;
  onToggleMenu: (id: number | null) => void;
  onHide: (application: ApplicationView, hidden: boolean) => void;
  onSetStatus: (application: ApplicationView, status: Status | null) => void;
};

/**
 * Which rows have their emails opened out under them. The sheet's alone: the
 * split view reads one row at a time in a pane of its own, so it tracks the
 * row that is picked instead of a set of open ones.
 */
export type RowDrawers = {
  open: Set<number>;
  onToggleRow: (id: number) => void;
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

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days from a stored date until now, and null when there is no date.
 *
 * Read at the moment it is drawn rather than stored, for the same reason
 * `isStale` is: an application does not get older because something happened
 * to it, and a stored answer would be wrong the day after it was written.
 */
export function daysSince(value: string | null): number | null {
  if (!value) return null;
  return Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / DAY_MS));
}

/**
 * How long ago a row last heard anything, in the few characters a list line
 * has room for: days up to a month, then weeks. Past a month the exact day has
 * stopped being the thing anyone is reading it for.
 */
export function formatAge(value: string | null): string {
  const days = daysSince(value);
  if (days === null) return "";
  if (days === 0) return "Today";
  if (days < 31) return `${days}d`;
  return `${Math.round(days / 7)}w`;
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

export function passesFilters(application: ApplicationView, filters: Filters): boolean {
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
