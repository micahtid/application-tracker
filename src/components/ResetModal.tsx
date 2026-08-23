"use client";

import Dialog from "./Dialog";

/**
 * Rescanning throws away work that cost money and cannot be got back, so what
 * it does is said plainly before it runs. One sentence covers it: everything
 * is read again, and reading again is what costs.
 */
export default function ResetModal({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      title="Rescan All"
      onClose={busy ? () => {} : onCancel}
      footer={
        <>
          <button className="btn btn--ghost" type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn--danger" type="button" disabled={busy} onClick={onConfirm}>
            {busy ? "Resetting…" : "Reset and Rescan"}
          </button>
        </>
      }
    >
      <p className="confirm__lead">
        Your mailbox is read from the start again, and every email is read by the model again, so
        this costs about what the first run did.
      </p>
    </Dialog>
  );
}
