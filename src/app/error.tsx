"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";

/**
 * What is drawn when the board itself throws while rendering.
 *
 * Only render errors reach here. A request that failed is caught by
 * `loadError` in `Tracker`, which says so in place without losing the board.
 *
 * Almost every failure here is a route that answered badly and will answer
 * well the second time, so the one thing offered is to try again.
 */
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="app" role="application" aria-label="Internship Applications Tracker">
      <div className="blank-page">
        <div className="blank">
          <span className="blank__icon">
            <TriangleAlert className="lucide" />
          </span>
          <p className="blank__title">Something Went Wrong</p>
          <p className="blank__text">
            The board could not be drawn. Trying again usually works.
          </p>
          <div className="blank__actions">
            <button className="btn" type="button" onClick={reset}>
              <RotateCcw className="lucide" />
              Try Again
            </button>
          </div>
          {error.message ? <p className="blank__note">{error.message}</p> : null}
        </div>
      </div>
    </main>
  );
}
