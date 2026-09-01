"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Settings, TriangleAlert, Unplug, X } from "lucide-react";
import AppBar from "./AppBar";
import ApplicationDetail from "./ApplicationDetail";
import ApplicationList from "./ApplicationList";
import FilterRail, { type FilterGroup } from "./FilterRail";
import Sheet from "./Sheet";
import SettingsModal, { type SettingsState } from "./SettingsModal";
import ResetModal from "./ResetModal";
import {
  matchQuery,
  passesFilters,
  sortApplications,
  toggled,
  type ApplicationView,
  type Filters,
  type Row,
  type SortKey,
} from "@/lib/view";
import { SEASONS, STATUSES, type Provider, type Status } from "@/lib/constants";
import { useDesign, useDismissOnOutsideClick, useListWidth } from "@/lib/hooks";
import { dayString, plural } from "@/lib/text";

type SyncRun = {
  id: number;
  status: "RUNNING" | "OK" | "PARTIAL" | "FAILED";
  mode: "FULL" | "INCREMENTAL";
  stage: "DISCOVERING" | "FETCHING" | "CLASSIFYING" | "TIDYING";
  stageDone: number;
  stageTotal: number;
  messagesDiscovered: number;
  messagesFetched: number;
  messagesClassified: number;
  errors: number;
  errorSummary: string | null;
};

/**
 * One readout for every sync, the first backfill and a refresh alike. Each of
 * the three stages owns a third of the bar and fills it as far as it has got,
 * so the bar always moves the same way.
 */
function syncProgress(run: SyncRun): { text: string; count: string; percent: number } {
  // Titled, like every other label on the screen, because this one sits
  // opposite the stage as the answer to it.
  const emails = (done: number, total: number) =>
    `${done} of ${plural(total, "Email")}`;

  // A stage that has not said how much work it has yet sits at the start of
  // its own third rather than guessing.
  const filled = (base: number) =>
    base + 33 * (run.stageTotal ? Math.min(1, run.stageDone / run.stageTotal) : 0);

  switch (run.stage) {
    case "DISCOVERING":
      return {
        text:
          run.mode === "FULL"
            ? "Reading Your Inbox for the First Time…"
            : "Searching Your Inbox…",
        // Nothing is written in the count slot until there is a real number
        // to write there.
        count: run.messagesDiscovered ? `${run.messagesDiscovered} Emails Found` : "",
        percent: Math.max(2, filled(0)),
      };
    case "FETCHING":
      return {
        text: "Downloading New Emails…",
        count: emails(run.stageDone, run.stageTotal),
        percent: filled(33),
      };
    case "CLASSIFYING":
      return {
        text: "Reading New Emails…",
        count: emails(run.stageDone, run.stageTotal),
        percent: filled(66),
      };
    default:
      return { text: "Sorting What Came Back…", count: "", percent: 100 };
  }
}

type StateResponse = {
  state: "CONNECTED" | "NOT_CONNECTED" | "RECONNECT";
  missing: "ACCOUNT" | "KEY" | null;
  googleConfigured: boolean;
  account: { email: string; displayName: string | null; firstName: string | null } | null;
  provider: Provider | null;
  providers: Record<Provider, { label: string; model: string }>;
  hasKey: boolean;
  readFromDate: string | null;
  /** The earliest day the sweep will read from, worked out by the server. */
  earliest: string;
  usageUsd: number;
  sync: SyncRun | null;
};

const isoDay = (date: Date) => dayString(date, "-");

/**
 * The width below which the two panes cannot both fit, so the reading pane
 * slides in over the list instead of sitting beside it. It matches the
 * breakpoint the stylesheet lays the panes out at, and is the only place in
 * this file that asks about the size of the window.
 */
const NARROW = "(max-width: 899px)";

const isNarrow = () => window.matchMedia(NARROW).matches;

/**
 * Every request this file makes, so a request that failed says what failed
 * rather than throwing where the body is parsed.
 *
 * A route that raises returns no body at all, so `response.json()` threw
 * "Unexpected end of JSON input" from inside whichever callback happened to
 * run first. That names the parser rather than the request, and points at a
 * line of this file that had nothing to do with it.
 *
 * Passing a body sends it as JSON and makes the request a POST, unless another
 * method is named.
 */
async function askServer<T>(
  url: string,
  body?: { method?: string; json?: unknown },
): Promise<T> {
  const response = await fetch(
    url,
    body
      ? {
          method: body.method ?? "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body.json ?? {}),
        }
      : undefined,
  );

  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}. The server log says why.`);
  }
  return (await response.json()) as T;
}

/** How the sync is going, asked of our own server and never of Google. */
const fetchSyncRun = () => askServer<{ sync: SyncRun | null }>("/api/sync");

export default function Tracker() {
  const [data, setData] = useState<StateResponse | null>(null);
  const [applications, setApplications] = useState<ApplicationView[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [filters, setFilters] = useState<Filters>({ season: new Set(), year: new Set() });
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<Status>>(new Set());
  const [sortOpen, setSortOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<number | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  /** Which row the reading pane is reading, and null before anything is loaded. */
  const [picked, setPicked] = useState<number | null>(null);
  /** Whether that pane is over the list, which only happens on a narrow screen. */
  const [reading, setReading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [dismissedRun, setDismissedRun] = useState<number | null>(null);
  /** The last request that failed, so a broken route says so on screen. */
  const [loadError, setLoadError] = useState<string | null>(null);

  const [design, chooseDesign] = useDesign();
  const [listWidth, chooseListWidth] = useListWidth();

  const searchRef = useRef<HTMLInputElement>(null);
  const syncedOnOpen = useRef(false);

  /** The three places that refresh only the sync readout, written once. */
  const setSync = useCallback((sync: SyncRun | null) => {
    setData((current) => (current ? { ...current, sync } : current));
  }, []);

  const load = useCallback(async () => {
    const [stateResponse, applicationsResponse] = await Promise.all([
      askServer<StateResponse>("/api/state"),
      askServer<{ applications: ApplicationView[] }>("/api/applications"),
    ]);
    setData(stateResponse);
    setApplications(applicationsResponse.applications);
    setLoadError(null);
    setLoaded(true);
    return stateResponse;
    // Nothing here reads `applications`. The rule reports it because
    // `setApplications` is named after it, and a state setter never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startSync = useCallback(
    async (force: boolean) => {
      // A refused start needs no banner of its own. The readout is asked for
      // its own state on the next line and shows whatever really happened.
      await askServer("/api/sync", { json: { force } }).catch(() => null);
      setSync((await fetchSyncRun()).sync);
    },
    [setSync],
  );

  // The board draws from saved data immediately; syncing never blocks it.
  useEffect(() => {
    // The state written below is not written synchronously, whatever the rule
    // reads here: it happens once two requests have come back, long after the
    // effect itself returned.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().then((state) => {
      // React's development mode runs effects twice, so the sync is guarded by
      // a ref as well as by the server side lock.
      if (syncedOnOpen.current) return;
      syncedOnOpen.current = true;
      if (state.state === "CONNECTED") void startSync(false);
      if (!state.hasKey || state.state !== "CONNECTED") setSettingsOpen(state.state !== "RECONNECT");
    });
    // Runs once, on open. The guard above is what makes that true in
    // development, where React runs an effect twice on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Throw away everything the syncs built and read the mailbox again from the
   * start.
   *
   * The dialog closes the moment it is confirmed and the board drops back to
   * the empty state it shows before its first load. The rows on screen are
   * already gone by then, so holding the dialog open over them until the work
   * finishes shows something that is no longer true, and the wait is the sync's
   * rather than the dialog's.
   */
  const resetAll = useCallback(async () => {
    setResetOpen(false);
    setResetting(true);
    setLoaded(false);
    setApplications([]);

    try {
      await askServer("/api/reset", { json: {} });
      await load();
      setSync((await fetchSyncRun()).sync);
    } catch (error) {
      // Nothing was reloaded, so the board would sit blank for ever with no
      // word of why. Say what happened and let it be read.
      setLoadError(error instanceof Error ? error.message : String(error));
      setLoaded(true);
    } finally {
      setResetting(false);
    }
  }, [load, setSync]);

  // While a sync runs, ask our own server how it is going about once a second.
  // This never contacts Google.
  const running = data?.sync?.status === "RUNNING";
  useEffect(() => {
    if (!running) return;

    const timer = setInterval(async () => {
      const { sync } = await fetchSyncRun();
      setSync(sync);
      if (sync?.status !== "RUNNING") void load();
    }, 1000);

    return () => clearInterval(timer);
  }, [running, load, setSync]);

  // Keyboard: slash jumps to search, Escape clears it, closes menus, and sends
  // the reading pane away again on a screen too narrow to hold both.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSortOpen(false);
        setRowMenu(null);
        setReading(false);
        if (document.activeElement === searchRef.current) setQuery("");
        return;
      }
      const modalOpen = settingsOpen || resetOpen;
      if (event.key === "/" && document.activeElement !== searchRef.current && !modalOpen) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [settingsOpen, resetOpen]);

  // Any click outside a row menu closes it.
  useDismissOnOutsideClick(rowMenu !== null, () => setRowMenu(null));

  const hiddenCount = applications.filter((application) => application.isHidden).length;

  const onBoard = useMemo(
    () => applications.filter((application) => showHidden || !application.isHidden),
    [applications, showHidden],
  );

  const rows: Row[] = useMemo(() => {
    const matched = onBoard
      .map((application) => ({ application, match: matchQuery(application, query) }))
      .filter(({ application, match }) => match.hit && passesFilters(application, filters));

    // Looked up by id rather than searched for, so sorting a long board stays
    // one pass over it instead of one pass for every row on it.
    const viaEmail = new Map(matched.map((entry) => [entry.application.id, entry.match.viaEmail]));

    return sortApplications(
      matched.map(({ application }) => application),
      sort,
    ).map((application) => ({
      app: application,
      viaEmail: viaEmail.get(application.id)!,
    }));
  }, [onBoard, query, filters, sort]);

  const totals = useMemo(() => {
    const counts = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<Status, number>;
    for (const application of onBoard) counts[application.status] += 1;
    return counts;
  }, [onBoard]);

  /**
   * The rail's two groups, each line carrying the number of rows that answer
   * to it. Counted off the season rather than off the stated term, because the
   * season is the bucket the filter itself compares.
   */
  const filterGroups: FilterGroup[] = useMemo(() => {
    const years = [
      ...new Set(applications.map((application) => application.year).filter(Boolean)),
    ].sort() as number[];

    return [
      {
        group: "season",
        label: "Term",
        emptyLabel: "No Terms Yet",
        options: SEASONS.map((season) => ({
          value: season,
          label: season,
          count: onBoard.filter((application) => application.season === season).length,
        })),
      },
      {
        group: "year",
        label: "Year",
        emptyLabel: "No Years Yet",
        options: years.map((year) => ({
          value: String(year),
          label: String(year),
          count: onBoard.filter((application) => application.year === year).length,
        })),
      },
    ];
  }, [applications, onBoard]);

  const narrowed = Boolean(query) || filters.season.size > 0 || filters.year.size > 0;

  /**
   * The row the reading pane is showing. Worked out from the rows on screen
   * rather than trusted, so a pick that the search or a filter has just taken
   * off the board falls back to the top of the list instead of leaving the
   * pane reading something no longer there.
   */
  const pickedRow = rows.find(({ app }) => app.id === picked) ?? rows[0] ?? null;

  async function patchApplication(id: number, body: Record<string, unknown>) {
    // A refused change needs no banner either: the reload below redraws the row
    // from what the server actually holds.
    await askServer(`/api/applications/${id}`, { method: "PATCH", json: body }).catch(() => null);
    setRowMenu(null);
    await load();
  }

  const banner =
    data?.sync &&
    (data.sync.status === "FAILED" || data.sync.status === "PARTIAL") &&
    dismissedRun !== data.sync.id
      ? data.sync
      : null;

  // Rebuilt only when the state behind it changes, rather than on every one of
  // the once a second renders a running sync causes.
  const settingsState: SettingsState | null = useMemo(
    () =>
      data
        ? {
            account: data.account
              ? { email: data.account.email, firstName: data.account.firstName }
              : null,
            provider: data.provider,
            providers: data.providers,
            hasKey: data.hasKey,
            readFromDate: data.readFromDate,
            usageUsd: data.usageUsd,
            earliest: data.earliest,
            today: isoDay(new Date()),
            googleConfigured: data.googleConfigured,
          }
        : null,
    [data],
  );

  const disconnected = data ? data.state !== "CONNECTED" : false;

  const progress = running && data?.sync ? syncProgress(data.sync) : null;

  // What a row can be told to do, which is the same in both designs, so it is
  // written once here rather than at each of the two call sites.
  const rowActions = {
    menuFor: rowMenu,
    onToggleMenu: setRowMenu,
    onHide: (application: ApplicationView, hidden: boolean) =>
      void patchApplication(application.id, { isHidden: hidden }),
    onSetStatus: (application: ApplicationView, status: Status | null) =>
      void patchApplication(application.id, { statusOverride: status ?? "AUTO" }),
  };

  return (
    <main className="app" role="application" aria-label="Internship Applications Tracker">
      {/* The dragged width of the list pane rides on the shell as a custom
          property, which is the same property the stylesheet's own breakpoints
          set, so a drag simply overrides the width the screen started with. */}
      <div
        className={`shell${reading ? " is-reading" : ""}`}
        style={listWidth ? ({ "--list-w": `${listWidth}px` } as React.CSSProperties) : undefined}
      >
        <AppBar
          firstName={data?.account?.firstName ?? null}
          query={query}
          onQuery={setQuery}
          searchRef={searchRef}
          design={design}
          onDesign={chooseDesign}
          disconnected={disconnected}
          syncing={running}
          onRefresh={() => void startSync(true)}
          onRescan={() => setResetOpen(true)}
          onSettings={() => setSettingsOpen(true)}
        />

        {/* A failed sync does not invalidate anything already saved, so these
            sit above the board rather than in place of it. */}
        <div className="notices">
          {loadError ? (
            <div className="banner">
              <TriangleAlert className="lucide banner__icon" />
              <div className="banner__body">
                <p className="banner__title">The Board Could Not Be Read</p>
                <p className="banner__text">{loadError}</p>
              </div>
              <button
                className="icon-btn icon-btn--sm"
                type="button"
                aria-label="Dismiss"
                onClick={() => setLoadError(null)}
              >
                <X className="lucide" />
              </button>
            </div>
          ) : null}

          {banner ? (
            <div className="banner">
              <TriangleAlert className="lucide banner__icon" />
              <div className="banner__body">
                <p className="banner__title">
                  {banner.status === "FAILED" ? "The Last Sync Failed" : "The Last Sync Did Not Finish"}
                </p>
                <p className="banner__text">
                  {banner.errorSummary ?? "Some emails could not be read."}
                </p>
              </div>
              <button
                className="icon-btn icon-btn--sm"
                type="button"
                aria-label="Dismiss"
                onClick={() => setDismissedRun(banner.id)}
              >
                <X className="lucide" />
              </button>
            </div>
          ) : null}

          {progress ? (
            <div className="progress">
              <div className="progress__row">
                <span>{progress.text}</span>
                <span className="progress__count">{progress.count}</span>
              </div>
              {/* Three parts, because the Material 3 indicator is three: how
                  far it has got, the track still to cross, and the dot marking
                  where that track ends. The space between the first two is the
                  flex gap, so it is a real gap rather than a patch painted in
                  whatever colour happens to be behind. */}
              <div
                className="progress__track"
                role="progressbar"
                aria-label="Sync Progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress.percent)}
              >
                <span className="progress__bar" style={{ flexBasis: `${progress.percent}%` }} />
                <span className="progress__rest" />
                <span className="progress__stop" />
              </div>
            </div>
          ) : null}
        </div>

        {disconnected ? (
          <div className="blank">
            <span className="blank__icon">
              <Unplug className="lucide" />
            </span>
            <p className="blank__title">
              {data?.state === "RECONNECT" ? "Reconnect Gmail" : "Not Connected"}
            </p>
            <p className="blank__text">
              {data?.state === "RECONNECT"
                ? "Gmail access has expired. Sign in again to keep reading your inbox."
                : data?.missing === "ACCOUNT"
                  ? "Sign in to Gmail to get started."
                  : "Add an API key to get started."}
            </p>
            {/* Not Connected offers one button, into Settings, because that is
                where both missing pieces are filled in. Reconnect is different:
                the only thing to do there is run consent again. */}
            <div className="blank__actions">
              {data?.state === "RECONNECT" ? (
                <a className="btn" href="/api/auth/google/start">
                  Reconnect
                </a>
              ) : (
                <button className="btn" type="button" onClick={() => setSettingsOpen(true)}>
                  <Settings className="lucide" />
                  Open Settings
                </button>
              )}
            </div>
            {!data?.googleConfigured ? (
              <p className="blank__note">
                No Google client is configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to
                .env.local, then restart the app. README.md has the steps.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="panes">
            <FilterRail
              groups={filterGroups}
              filters={filters}
              shown={rows.length}
              total={onBoard.length}
              narrowed={narrowed}
              hiddenCount={hiddenCount}
              showHidden={showHidden}
              onToggleFilter={(group, value) =>
                setFilters((current) => ({ ...current, [group]: toggled(current[group], value) }))
              }
              onClearFilters={() => setFilters({ season: new Set(), year: new Set() })}
              onToggleHidden={() => setShowHidden((value) => !value)}
            />

            {design === "board" ? (
              <>
                <ApplicationList
                  rows={rows}
                  totals={totals}
                  total={onBoard.length}
                  collapsed={collapsed}
                  picked={pickedRow?.app.id ?? null}
                  query={query}
                  narrowed={narrowed}
                  loaded={loaded}
                  sort={sort}
                  sortOpen={sortOpen}
                  width={listWidth}
                  onToggleSection={(key) => setCollapsed((current) => toggled(current, key))}
                  onPick={(id) => {
                    setPicked(id);
                    setRowMenu(null);
                    if (isNarrow()) setReading(true);
                  }}
                  onSort={setSort}
                  onOpenSort={setSortOpen}
                  onWidth={chooseListWidth}
                />

                <ApplicationDetail
                  application={pickedRow?.app ?? null}
                  query={query}
                  onBack={() => setReading(false)}
                  {...rowActions}
                />
              </>
            ) : (
              <Sheet
                rows={rows}
                total={onBoard.length}
                query={query}
                narrowed={narrowed}
                loaded={loaded}
                sort={sort}
                onSort={setSort}
                open={open}
                onToggleRow={(id) => setOpen((current) => toggled(current, id))}
                onToggleAll={() =>
                  setOpen((current) =>
                    current.size ? new Set() : new Set(rows.map(({ app }) => app.id)),
                  )
                }
                {...rowActions}
              />
            )}
          </div>
        )}
      </div>

      {resetOpen ? (
        <ResetModal
          busy={resetting}
          onCancel={() => setResetOpen(false)}
          onConfirm={() => void resetAll()}
        />
      ) : null}

      {settingsOpen && settingsState ? (
        <SettingsModal
          settings={settingsState}
          onClose={() => setSettingsOpen(false)}
          onSaved={async () => {
            setSettingsOpen(false);
            const state = await load();
            if (state.state === "CONNECTED") void startSync(true);
          }}
          onSignOut={async () => {
            await askServer("/api/auth/logout", { json: {} }).catch(() => null);
            await load();
          }}
        />
      ) : null}
    </main>
  );
}
