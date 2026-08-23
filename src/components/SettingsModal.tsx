"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CircleAlert,
  CircleCheck,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LogIn,
  LogOut,
  User,
  X,
} from "lucide-react";
import type { Provider } from "@/lib/constants";

type KeyPhase = "idle" | "checking" | "valid" | "invalid";

export type SettingsState = {
  account: { email: string; firstName: string | null } | null;
  provider: Provider | null;
  providers: Record<Provider, { label: string; model: string }>;
  hasKey: boolean;
  readFromDate: string | null;
  usageUsd: number;
  earliest: string;
  today: string;
  googleConfigured: boolean;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function SettingsModal({
  settings,
  onClose,
  onSaved,
  onSignOut,
}: {
  settings: SettingsState;
  onClose: () => void;
  onSaved: () => void;
  onSignOut: () => void;
}) {
  const [keyValue, setKeyValue] = useState("");
  const [verifiedKey, setVerifiedKey] = useState("");
  const [phase, setPhase] = useState<KeyPhase>(settings.hasKey ? "valid" : "idle");
  const [message, setMessage] = useState("");
  const [revealed, setRevealed] = useState(false);
  // The provider is read out of the key, never chosen (D10).
  const [detected, setDetected] = useState<Provider | null>(
    settings.hasKey ? settings.provider : null,
  );
  const [startDate, setStartDate] = useState(
    (settings.readFromDate ?? settings.earliest).slice(0, 10),
  );
  const [saving, setSaving] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /**
   * A modal dialog owns the keyboard while it is open: focus starts inside it,
   * Tab cycles within it, Escape closes it, and focus goes back to whatever
   * opened it. Without that, Tab wanders off behind the scrim and the page
   * underneath becomes a maze.
   */
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;

    // The key field is what you came here to fill in, unless one is saved,
    // in which case nothing is demanded of you and Close is the safe start.
    (settings.hasKey ? closeRef.current : keyInputRef.current)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;

      const stops = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null,
      );
      if (!stops.length) return;

      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      opener?.focus?.();
    };
  }, [onClose, settings.hasKey]);

  const savedKeyStillStands = settings.hasKey && !keyValue;
  const keyReady = Boolean(keyValue) && keyValue.trim() === verifiedKey;
  const canSave = !saving && (savedKeyStillStands || keyReady);

  // A disabled button with no explanation is the usual way a settings screen
  // strands someone, so the reason sits next to it.
  const blockedReason = canSave
    ? null
    : keyValue
      ? "Check the key to enable Save."
      : "Add an API key to enable Save.";

  async function check() {
    if (!keyValue.trim()) return;
    setPhase("checking");
    setMessage("");

    const response = await fetch("/api/settings/check-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: keyValue.trim() }),
    });
    const result = (await response.json()) as {
      ok: boolean;
      provider?: Provider;
      message?: string;
    };

    setDetected(result.provider ?? null);

    if (result.ok) {
      setVerifiedKey(keyValue.trim());
      setPhase("valid");
    } else {
      setVerifiedKey("");
      setPhase("invalid");
      setMessage(result.message ?? "The key was rejected. Check it and try again.");
    }
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);

    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        readFromDate: startDate,
        ...(keyValue ? { apiKey: keyValue.trim() } : {}),
      }),
    });

    setSaving(false);

    if (!response.ok) {
      const failure = (await response.json()) as { error?: string };
      setPhase("invalid");
      setMessage(failure.error ?? "That could not be saved.");
      return;
    }

    onSaved();
  }

  const KeyIcon = { idle: KeyRound, checking: LoaderCircle, valid: CircleCheck, invalid: CircleAlert }[
    phase
  ];

  const provider = detected ? settings.providers[detected] : null;

  /**
   * The dialog hangs off the body rather than off the page that opened it. A
   * fixed box is measured against the nearest ancestor carrying a transform,
   * and the page carries one for its entry animation, so a dialog left in
   * place would centre itself on the whole page instead of the screen.
   */
  return createPortal(
    <div className="modal">
      <div className="modal__scrim" onClick={onClose} />

      <div
        className="modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settingsTitle"
        ref={panelRef}
      >
        <header className="modal__head">
          <h2 className="modal__title" id="settingsTitle">
            Settings
          </h2>
          <button
            className="icon-btn modal__close"
            type="button"
            aria-label="Close Settings"
            onClick={onClose}
            ref={closeRef}
          >
            <X className="lucide" />
          </button>
        </header>

        <div className="modal__body">
          {/* 1. The mailbox to read */}
          <section className="group">
            <div className="group__head">
              <span className="group__label">
                <abbr className="req" title="Required">
                  *
                </abbr>
                Gmail Account
              </span>
            </div>
            <p className="group__note">The inbox the board reads from.</p>

            <div className={`account${settings.account ? "" : " is-signed-out"}`}>
              <span className="account__avatar">
                {settings.account ? (
                  settings.account.email[0].toUpperCase()
                ) : (
                  <User className="lucide" />
                )}
              </span>
              <span className="account__mail">{settings.account?.email ?? "Not Signed In"}</span>
              {settings.account ? (
                <button
                  className="icon-btn icon-btn--sm"
                  type="button"
                  aria-label="Log Out"
                  title="Log Out"
                  onClick={onSignOut}
                >
                  <LogOut className="lucide" />
                </button>
              ) : (
                // Signed out, this is the one thing to do here, so it is
                // spelled out rather than left as an icon to decode. Logging
                // out stays an icon: you already know where you are.
                <a
                  className="btn btn--compact"
                  href="/api/auth/google/start"
                  title={settings.googleConfigured ? "Sign In" : "Add a Google client first"}
                  aria-disabled={!settings.googleConfigured}
                  onClick={(event) => {
                    if (!settings.googleConfigured) event.preventDefault();
                  }}
                >
                  <LogIn className="lucide" />
                  Sign In
                </a>
              )}
            </div>

            {!settings.googleConfigured ? (
              <p className="group__hint">
                Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local first. README.md has the
                steps.
              </p>
            ) : null}
          </section>

          {/* 2. The key. The provider comes from the key, so there is nothing to pick. */}
          <section className="group">
            <div className="group__head">
              <label className="group__label" htmlFor="apiKey">
                <abbr className="req" title="Required">
                  *
                </abbr>
                API Key
              </label>
            </div>
            <p className="group__note">
              OpenRouter, Anthropic, or Gemini. The provider is read from the key.
            </p>

            <div className="key-row">
              <div
                className={`field field--key${phase === "valid" ? " is-valid" : ""}${
                  phase === "invalid" ? " is-invalid" : ""
                }${phase === "checking" ? " is-checking" : ""}`}
              >
                <KeyIcon className="lucide field__icon" />
                <input
                  id="apiKey"
                  ref={keyInputRef}
                  type={revealed ? "text" : "password"}
                  placeholder={settings.hasKey ? "A key is saved. Type to replace it." : "sk-or-…"}
                  autoComplete="off"
                  spellCheck={false}
                  value={keyValue}
                  onChange={(event) => {
                    const value = event.target.value;
                    setKeyValue(value);
                    // Editing a checked key makes it unchecked again (5.5).
                    if (value.trim() !== verifiedKey) {
                      setPhase(!value && settings.hasKey ? "valid" : "idle");
                      setDetected(!value && settings.hasKey ? settings.provider : null);
                      setMessage("");
                    } else {
                      setPhase("valid");
                    }
                  }}
                />
                <button
                  className="icon-btn icon-btn--sm"
                  type="button"
                  aria-label={revealed ? "Hide Key" : "Show Key"}
                  onClick={() => setRevealed((value) => !value)}
                >
                  {revealed ? <EyeOff className="lucide" /> : <Eye className="lucide" />}
                </button>
              </div>

              <button
                className="btn"
                type="button"
                disabled={keyValue.trim().length < 4 || phase === "checking"}
                onClick={check}
              >
                {phase === "checking" ? "Checking…" : "Check"}
              </button>
            </div>

            <p className="status" data-state={phase} role="status">
              {message}
            </p>

            {/* One quiet line of read only facts about the key: who it is with,
                which model it drives, and what it has cost so far. They are all
                answers rather than things to fill in, so they read as one line
                under the field instead of as sections of their own. */}
            <p className="key-meta">
              {provider && phase === "valid" ? (
                <>
                  <span className="key-meta__provider">{provider.label}</span>
                  <span className="key-meta__model">{provider.model}</span>
                </>
              ) : null}
              <span className="key-meta__usage">${settings.usageUsd.toFixed(2)}</span>
            </p>
          </section>

          {/* 3. How far back to read */}
          <section className="group">
            <div className="group__head">
              <label className="group__label" htmlFor="startDate">
                <abbr className="req" title="Required">
                  *
                </abbr>
                Read Emails From
              </label>
            </div>
            <p className="group__note">
              Every sync reads from this date to today. You can go back one year at most.
            </p>

            <div className="date-row">
              <span className="date-row__label">Starting</span>
              <input
                className="date-input"
                id="startDate"
                type="date"
                min={settings.earliest}
                max={settings.today}
                value={startDate}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) return;
                  setStartDate(
                    value < settings.earliest
                      ? settings.earliest
                      : value > settings.today
                        ? settings.today
                        : value,
                  );
                }}
              />
              <span className="date-row__end">to Today</span>
            </div>
          </section>
        </div>

        <footer className="modal__foot">
          {blockedReason ? <p className="modal__reason">{blockedReason}</p> : null}
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canSave} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
