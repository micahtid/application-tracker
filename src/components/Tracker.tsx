"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Inbox, RefreshCw, Settings, TriangleAlert, Unplug, X } from "lucide-react";
import Board, { type Row } from "./Board";
import Toolbar from "./Toolbar";
import SettingsModal, { type SettingsState } from "./SettingsModal";
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
  messagesDiscovered: number;
  messagesFetched: number;
  messagesClassified: number;
  errors: number;
  errorSummary: string | null;
};

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
      if (event.key === "/" && document.activeElement !== searchRef.current && !settingsOpen) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [settingsOpen]);

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

  return (
    <main className="app" role="application" aria-label="Internship Applications Tracker">
      <div className={`page${disconnected ? " is-disconnected" : ""}`}>
        <header className="masthead reveal" style={{ "--i": 0 } as React.CSSProperties}>
          <div className="masthead__row">
            <h1 className="greeting">
              Welcome back, <span>{data?.account?.firstName ?? "there"}</span>
            </h1>
            <button
              className={`icon-btn${running ? " is-spinning" : ""}`}
              type="button"
              aria-label="Refresh"
              title={disconnected ? "Not connected" : "Refresh"}
              disabled={disconnected || running}
              onClick={() => void startSync(true)}
            >
              <RefreshCw className="lucide" />
            </button>
            <button
              className="icon-btn"
              type="button"
              aria-label="Settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="lucide" />
            </button>
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
                ? "Gmail access has lapsed. Sign in again to carry on reading your inbox."
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
                    {banner.status === "FAILED" ? "The last sync failed" : "The last sync half finished"}
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

            {/* A readout only during the first backfill, which takes minutes (4). */}
            {running && data?.sync?.mode === "FULL" ? (
              <div className="progress">
                <div className="progress__row">
                  <span>Reading your inbox for the first time…</span>
                  <span className="progress__count">
                    {data.sync.messagesClassified} of {data.sync.messagesDiscovered || "…"} emails
                  </span>
                </div>
                <div className="progress__track">
                  <div
                    className="progress__bar"
                    style={{
                      width: `${
                        data.sync.messagesDiscovered
                          ? Math.min(
                              100,
                              Math.round(
                                (data.sync.messagesClassified / data.sync.messagesDiscovered) * 100,
                              ),
                            )
                          : 4
                      }%`,
                    }}
                  />
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
                      No applications match <b>&quot;{query}&quot;</b>
                    </>
                  ) : narrowed ? (
                    <>No applications match the current filters</>
                  ) : (
                    <>Nothing tracked yet. The next sync will fill this in.</>
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
                    {showHidden ? "Hide them again" : `${hiddenCount} hidden`}
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
