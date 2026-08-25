"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Eraser,
  Inbox,
  RefreshCw,
  Rows3,
  Settings,
  Table,
  TriangleAlert,
  Unplug,
  X,
} from "lucide-react";
import Board from "./Board";
import Sheet from "./Sheet";
import Toolbar from "./Toolbar";
import SettingsModal, { type SettingsState } from "./SettingsModal";
import ResetModal from "./ResetModal";
import {
  matchQuery,
  passesFilters,
  DESIGNS,
  sortApplications,
  toggled,
  type ApplicationView,
  type Design,
  type Row,
  type SortKey,
} from "@/lib/view";
import { STATUSES, type Provider, type Status } from "@/lib/constants";
import { useDismissOnOutsideClick } from "@/lib/hooks";
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
  const emails = (done: number, total: number) =>
    `${done} of ${plural(total, "email")}`;

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
        count: run.messagesDiscovered ? `${run.messagesDiscovered} emails found` : "",
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
 * Where the chosen design is kept between visits. The browser's own storage
 * rather than the database, because it is a fact about the screen it is read
 * on: the same account can want a sheet on a monitor and a board on a laptop.
 */
const DESIGN_KEY = "tracker.design";

const isDesign = (value: string | null): value is Design =>
  DESIGNS.includes(value as Design);

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
  const [filters, setFilters] = useState({ season: new Set<string>(), year: new Set<string>() });
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<Status>>(new Set());
  const [design, setDesign] = useState<Design>("board");
  const [toolbarMenu, setToolbarMenu] = useState<"sort" | "filter" | null>(null);
  const [rowMenu, setRowMenu] = useState<number | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [dismissedRun, setDismissedRun] = useState<number | null>(null);
  /** The last request that failed, so a broken route says so on screen. */
  const [loadError, setLoadError] = useState<string | null>(null);

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

  /**
   * The saved choice, read after the first paint rather than during it. The
   * server cannot see this browser's storage, so reading it while rendering
   * would have the markup it sends disagree with the markup the browser
   * builds. The rest of the page arrives a moment later anyway.
   */
  useEffect(() => {
    const saved = window.localStorage.getItem(DESIGN_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isDesign(saved)) setDesign(saved);
  }, []);

  const chooseDesign = useCallback((next: Design) => {
    setDesign(next);
    // A browser set to refuse storage throws here. The design still changes;
    // only the remembering is lost, so there is nothing to report.
    try {
      window.localStorage.setItem(DESIGN_KEY, next);
    } catch {
      /* nothing to do */
    }
  }, []);

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

  // Keyboard: slash jumps to search, Escape clears it and closes menus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setToolbarMenu(null);
        setRowMenu(null);
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

  const years = useMemo(
    () =>
      [...new Set(applications.map((application) => application.year).filter(Boolean))].sort() as number[],
    [applications],
  );

  const narrowed = Boolean(query) || filters.season.size > 0 || filters.year.size > 0;

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

  // What a row can do, which is the same in both designs, so it is written
  // once here rather than at each of the two call sites.
  const rowHandlers = {
    query,
    open,
    menuFor: rowMenu,
    onToggleRow: (id: number) => setOpen((current) => toggled(current, id)),
    onToggleMenu: setRowMenu,
    onHide: (application: ApplicationView, hidden: boolean) =>
      void patchApplication(application.id, { isHidden: hidden }),
    onSetStatus: (application: ApplicationView, status: Status | null) =>
      void patchApplication(application.id, { statusOverride: status ?? "AUTO" }),
  };

  return (
    <main className="app" role="application" aria-label="Internship Applications Tracker">
      <div className={`page${disconnected ? " is-disconnected" : ""}`}>
        <header className="masthead reveal" style={{ "--i": 0 } as React.CSSProperties}>
          <div className="masthead__row">
            <h1 className="greeting">
              Welcome back, <span>{data?.account?.firstName ?? "there"}</span>
            </h1>
            {/*
              Two groups split by a hairline: what acts on the mail, then what
              changes settings. The safe, often used button comes first in each
              group, and the gear stays at the end where a gear is looked for.

              Rescan All sits beside Refresh but is drawn as an eraser, so the
              dangerous one of the pair is never the one you meant to click.
            */}
            <div className="masthead__tools">
              <div className="masthead__group">
                <button
                  className={`icon-btn${running ? " is-spinning" : ""}`}
                  type="button"
                  aria-label="Refresh"
                  title={disconnected ? "Not Connected" : "Refresh"}
                  disabled={disconnected || running}
                  onClick={() => void startSync(true)}
                >
                  <RefreshCw className="lucide" />
                </button>
                <button
                  className="icon-btn icon-btn--danger"
                  type="button"
                  aria-label="Rescan All"
                  title={disconnected ? "Not Connected" : "Rescan All"}
                  disabled={disconnected || running}
                  onClick={() => setResetOpen(true)}
                >
                  <Eraser className="lucide" />
                </button>
              </div>

              <span className="masthead__rule" aria-hidden="true" />

              <div className="masthead__group">
                {/* Swaps the two designs. The icon is the one being switched
                    to, not the one on screen, because a toggle showing its own
                    state reads as a button that would set it. */}
                <button
                  className="icon-btn"
                  type="button"
                  aria-pressed={design === "sheet"}
                  aria-label={design === "board" ? "Switch to Sheet View" : "Switch to Board View"}
                  title={design === "board" ? "Sheet View" : "Board View"}
                  onClick={() => chooseDesign(design === "board" ? "sheet" : "board")}
                >
                  {design === "board" ? (
                    <Table className="lucide" />
                  ) : (
                    <Rows3 className="lucide" />
                  )}
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label="Settings"
                  title="Settings"
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings className="lucide" />
                </button>
              </div>
            </div>
          </div>
        </header>

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
          <>
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
                <div
                  className="progress__track"
                  role="progressbar"
                  aria-label="Sync Progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress.percent)}
                >
                  <div className="progress__bar" style={{ width: `${progress.percent}%` }} />
                </div>
              </div>
            ) : null}

            <Toolbar
              query={query}
              sort={sort}
              filters={filters}
              years={years}
              openMenu={toolbarMenu}
              onQuery={setQuery}
              onSort={(value) => setSort(value)}
              onToggleFilter={(group, value) =>
                setFilters((current) => ({ ...current, [group]: toggled(current[group], value) }))
              }
              onClearFilters={() => setFilters({ season: new Set(), year: new Set() })}
              onOpenMenu={setToolbarMenu}
              searchRef={searchRef}
            />

            {design === "board" ? (
              <Board
                rows={rows}
                totals={totals}
                collapsed={collapsed}
                onToggleSection={(key) => setCollapsed((current) => toggled(current, key))}
                {...rowHandlers}
              />
            ) : (
              <Sheet rows={rows} sort={sort} onSort={setSort} {...rowHandlers} />
            )}

            {loaded && !rows.length ? (
              <p className="empty">
                <Inbox className="lucide" />
                <span>
                  {query ? (
                    <>
                      No applications match <b>&quot;{query}&quot;</b>.
                    </>
                  ) : narrowed ? (
                    <>No applications match the current filters.</>
                  ) : (
                    <>Nothing is tracked yet. The next sync will add anything it finds.</>
                  )}
                </span>
              </p>
            ) : null}

            <footer className="footer reveal" style={{ "--i": 6 } as React.CSSProperties}>
              <span className="footer__left">
                <span>
                  {rows.length} of {onBoard.length} applications {narrowed ? "shown" : "tracked"}
                </span>
                {hiddenCount ? (
                  <button
                    className="footer__hidden"
                    type="button"
                    onClick={() => setShowHidden((value) => !value)}
                  >
                    {showHidden ? "Hide Them Again" : `${hiddenCount} Hidden`}
                  </button>
                ) : null}
              </span>
              <button
                className="linkish"
                type="button"
                onClick={() =>
                  setOpen((current) =>
                    current.size ? new Set() : new Set(rows.map(({ app }) => app.id)),
                  )
                }
              >
                {open.size ? "Collapse All" : "Expand All"}
              </button>
            </footer>
          </>
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
