import { STATUS_LABELS, type StageDetail, type Status } from "@/lib/constants";

/** The board's shape, as the browser sees it. */
export type EmailView = {
  id: number;
  title: string;
  date: string;
  href: string;
  /** REPEAT | REMINDER | UPDATE, or null on an email that holds its own line. */
  relation: "REPEAT" | "REMINDER" | "UPDATE" | null;
  /** Always present, often empty, and never nested further (LOOP2 3.2 rule 3). */
  children: EmailView[];
};

export type ApplicationView = {
  id: number;
  company: string;
  role: string | null;
  season: string | null;
  year: number | null;
  status: Status;
  statusOverride: Status | null;
  stageDetail: StageDetail | null;
  isHidden: boolean;
  latestEmailAt: string | null;
  firstEmailAt: string | null;
  atsVendor: string | null;
  emails: EmailView[];
};

/** Board order, written out rather than derived, so it cannot move by accident. */
export const SECTIONS: { key: Status; label: string; modifier: string }[] = [
  { key: "ACCEPTED", label: STATUS_LABELS.ACCEPTED, modifier: "accepted" },
  { key: "IN_PROGRESS", label: STATUS_LABELS.IN_PROGRESS, modifier: "progress" },
  { key: "APPLIED", label: STATUS_LABELS.APPLIED, modifier: "applied" },
  { key: "REJECTED", label: STATUS_LABELS.REJECTED, modifier: "rejected" },
];

export const SORTS = [
  { key: "company-asc", label: "Company · A to Z" },
  { key: "company-desc", label: "Company · Z to A" },
  { key: "recent", label: "Last Activity" },
  { key: "emails", label: "Most Emails" },
] as const;

export type SortKey = (typeof SORTS)[number]["key"];

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

  const header = [application.company, application.role, application.season, application.year]
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
      case "emails":
        // Top level lines only, so a long exchange about one step cannot
        // outrank a row that really reached more of them.
        return b.emails.length - a.emails.length || byCompany(a, b);
      default:
        return (b.latestEmailAt ?? "").localeCompare(a.latestEmailAt ?? "") || byCompany(a, b);
    }
  });
}
