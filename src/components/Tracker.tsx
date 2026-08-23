"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eraser, Inbox, Palette, RefreshCw, Settings, TriangleAlert, Unplug, X } from "lucide-react";
import Board, { type Row } from "./Board";
import Toolbar from "./Toolbar";
import SettingsModal, { type SettingsState } from "./SettingsModal";
import ResetModal from "./ResetModal";
import {
  matchQuery,
  passesFilters,
  sortApplications,
  type ApplicationView,
  type SortKey,
} from "@/lib/view";
import { STATUSES, type Provider, type Status } from "@/lib/constants";

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
 * One readout for every sync, the first backfill and a refresh alike (4).
 * Each of the three stages owns a third of the bar and fills its own third as
 * far as it has got, so the bar always moves the same way: a refresh spends
 * most of its time searching, a first run most of its time reading.
 */
function syncProgress(run: SyncRun): { text: string; count: string; percent: number } {
  const emails = (done: number, total: number) =>
    `${done} of ${total} email${total === 1 ? "" : "s"}`;

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
  usageUsd: number;
  sync: SyncRun | null;
};

const isoDay = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

export default function Tracker() {
  const [data, setData] = useState<StateResponse | null>(null);
  const [applications, setApplications] = useState<ApplicationView[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [filters, setFilters] = useState({ season: new Set<string>(), year: new Set<string>() });
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<Status>>(new Set());
  const [toolbarMenu, setToolbarMenu] = useState<"sort" | "filter" | null>(null);
  const [rowMenu, setRowMenu] = useState<number | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [dismissedRun, setDismissedRun] = useState<number | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const syncedOnOpen = useRef(false);

  const load = useCallback(async () => {
    const [stateResponse, applicationsResponse] = await Promise.all([
      fetch("/api/state").then((response) => response.json() as Promise<StateResponse>),
      fetch("/api/applications").then(
        (response) => response.json() as Promise<{ applications: ApplicationView[] }>,
      ),
    ]);
    setData(stateResponse);
    setApplications(applicationsResponse.applications);
    setLoaded(true);
    return stateResponse;
  }, []);

  // The board draws from saved data immediately; syncing never blocks it.
  useEffect(() => {
    load().then((state) => {
      // React's development mode runs effects twice, so the sync is guarded by
      // a ref as well as by the server side lock (Part 4).
      if (syncedOnOpen.current) return;
      syncedOnOpen.current = true;
      if (state.state === "CONNECTED") void startSync(false);
      if (!state.hasKey || state.state !== "CONNECTED") setSettingsOpen(state.state !== "RECONNECT");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startSync = useCallback(
    async (force: boolean) => {
      await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const response = await fetch("/api/sync").then(
        (result) => result.json() as Promise<{ sync: SyncRun | null }>,
      );
      setData((current) => (current ? { ...current, sync: response.sync } : current));
    },
    [],
  );

  /**
   * Throw away everything the syncs built and read the mailbox again from the
   * start. The board is reloaded before the dialog closes, so it empties in
   * front of you rather than sitting on rows that are already gone.
   */
  const resetAll = useCallback(async () => {
    setResetting(true);
    await fetch("/api/reset", { method: "POST" });
    await load();
    const response = await fetch("/api/sync").then(
      (result) => result.json() as Promise<{ sync: SyncRun | null }>,
    );
    setData((current) => (current ? { ...current, sync: response.sync } : current));
    setResetting(false);
    setResetOpen(false);
  }, [load]);

  // While a sync runs, ask our own server how it is going about once a second.
  // This never contacts Google (D24).
  const running = data?.sync?.status === "RUNNING";
  useEffect(() => {
    if (!running) return;

    const timer = setInterval(async () => {
      const response = await fetch("/api/sync").then(
        (result) => result.json() as Promise<{ sync: SyncRun | null }>,
      );
      setData((current) => (current ? { ...current, sync: response.sync } : current));
      if (response.sync?.status !== "RUNNING") void load();
    }, 1000);

    return () => clearInterval(timer);
  }, [running, load]);

  // Keyboard: slash jumps to search, Escape clears it and closes menus (5.4).
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
  useEffect(() => {
    if (rowMenu === null) return;
    const close = () => setRowMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [rowMenu]);

  const hiddenCount = applications.filter((application) => application.isHidden).length;

  const onBoard = useMemo(
    () => applications.filter((application) => showHidden || !application.isHidden),
    [applications, showHidden],
  );

  const rows: Row[] = useMemo(() => {
    const matched = onBoard
      .map((application) => ({ application, match: matchQuery(application, query) }))
      .filter(({ application, match }) => match.hit && passesFilters(application, filters));

    return sortApplications(
      matched.map(({ application }) => application),
      sort,
    ).map((application) => ({
      app: application,
      viaEmail: matched.find((entry) => entry.application.id === application.id)!.match.viaEmail,
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
    await fetch(`/api/applications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setRowMenu(null);
    await load();
  }

  const banner =
    data?.sync &&
    (data.sync.status === "FAILED" || data.sync.status === "PARTIAL") &&
    dismissedRun !== data.sync.id
      ? data.sync
      : null;

  const settingsState: SettingsState | null = data
    ? {
        account: data.account ? { email: data.account.email, firstName: data.account.firstName } : null,
        provider: data.provider,
        providers: data.providers,
        hasKey: data.hasKey,
        readFromDate: data.readFromDate,
        usageUsd: data.usageUsd,
        earliest: isoDay(
          (() => {
            const floor = new Date();
            floor.setMonth(floor.getMonth() - 12);
            return floor;
          })(),
        ),
        today: isoDay(new Date()),
        googleConfigured: data.googleConfigured,
      }
    : null;

  const disconnected = data ? data.state !== "CONNECTED" : false;

  const progress = running && data?.sync ? syncProgress(data.sync) : null;

  return (
    <main className="app" role="application" aria-label="Internship Applications Tracker">
      <div className={`page${disconnected ? " is-disconnected" : ""}`}>
        <header className="masthead reveal" style={{ "--i": 0 } as React.CSSProperties}>
          <div className="masthead__row">
            <h1 className="greeting">
              Welcome back, <span>{data?.account?.firstName ?? "there"}</span>
            </h1>
            {/*
              Two groups, split by a hairline: what acts on the mail, then what
              changes settings. Inside each group the safe, often used button
              comes first and the rare one follows, and the gear stays at the
              end of the row, which is where a gear is looked for.

              Rescan All sits beside Refresh because they are the same kind of
              thing, and is drawn as an eraser rather than another circular
              arrow so the dangerous one of the pair is never the one you meant
              to click. It reddens under the pointer, and asks before it runs.
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
                {/* Nothing behind it yet. Disabled rather than hidden, so the
                    row is the row it will be and does not shuffle later. */}
                <button className="icon-btn" type="button" aria-label="Style" title="Style" disabled>
                  <Palette className="lucide" />
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
                the only thing to do there is run consent again (5.6). */}
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
                setFilters((current) => {
                  const next = {
                    season: new Set(current.season),
                    year: new Set(current.year),
                  };
                  if (!next[group].delete(value)) next[group].add(value);
                  return next;
                })
              }
              onClearFilters={() => setFilters({ season: new Set(), year: new Set() })}
              onOpenMenu={setToolbarMenu}
              searchRef={searchRef}
            />

            <Board
              rows={rows}
              totals={totals}
              query={query}
              open={open}
              collapsed={collapsed}
              menuFor={rowMenu}
              onToggleRow={(id) =>
                setOpen((current) => {
                  const next = new Set(current);
                  if (!next.delete(id)) next.add(id);
                  return next;
                })
              }
              onToggleSection={(key) =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (!next.delete(key)) next.add(key);
                  return next;
                })
              }
              onToggleMenu={setRowMenu}
              onHide={(application, hidden) =>
                void patchApplication(application.id, { isHidden: hidden })
              }
              onSetStatus={(application, status) =>
                void patchApplication(application.id, { statusOverride: status ?? "AUTO" })
              }
            />

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
            await fetch("/api/auth/logout", { method: "POST" });
            await load();
          }}
        />
      ) : null}
    </main>
  );
}
