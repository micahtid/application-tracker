"use client";

import { Ellipsis, Eye, EyeOff, RotateCcw } from "lucide-react";
import MenuItem from "./MenuItem";
import { STATUSES, STATUS_LABELS, type Status } from "@/lib/constants";
import type { ApplicationView } from "@/lib/view";

/**
 * What a row can be told to do, and the button that opens it.
 *
 * The reading pane puts it beside the company name and the sheet puts it at
 * the end of a line, and neither knows which one it is sitting in: the popover
 * is the same popover the sort menu uses. Where it hides itself until the row
 * is under the pointer is decided by the pane around it, in globals.css.
 */
export default function RowMenu({
  application,
  open,
  onToggleMenu,
  onHide,
  onSetStatus,
}: {
  application: ApplicationView;
  open: boolean;
  onToggleMenu: (id: number | null) => void;
  onHide: (application: ApplicationView, hidden: boolean) => void;
  onSetStatus: (application: ApplicationView, status: Status | null) => void;
}) {
  return (
    <div className="rowmenu">
      <button
        className="rowmenu__btn"
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Row Options"
        onClick={(event) => {
          event.stopPropagation();
          onToggleMenu(open ? null : application.id);
        }}
      >
        <Ellipsis className="lucide" />
      </button>

      {open ? (
        <div className="menu" role="menu" onClick={(event) => event.stopPropagation()}>
          <button
            className="menu__item"
            role="menuitem"
            onClick={() => onHide(application, !application.isHidden)}
          >
            {application.isHidden ? <Eye className="lucide" /> : <EyeOff className="lucide" />}
            {application.isHidden ? "Show on the Board" : "Hide This Row"}
          </button>

          <p className="menu__label menu__label--sep">Set Status</p>
          {/* The modifier sends the tick to the far end, so the labels
              start where the menu does. */}
          {STATUSES.map((status) => (
            <MenuItem
              key={status}
              role="menuitemradio"
              checked={application.statusOverride === status}
              className="menu__item--status"
              onClick={() => onSetStatus(application, status)}
            >
              {STATUS_LABELS[status]}
            </MenuItem>
          ))}

          <div className="menu__foot">
            <button
              className="menu__clear"
              type="button"
              onClick={() => onSetStatus(application, null)}
            >
              <RotateCcw className="lucide" />
              Reset
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
