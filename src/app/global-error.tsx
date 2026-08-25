"use client";

import "./globals.css";

/**
 * The last resort, for an error that escapes the root layout.
 *
 * This one replaces the layout rather than sitting inside it, so it has to
 * draw its own html and body. That also means the font module is not in play,
 * and the styles it can rely on are only the ones in globals.css.
 */
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <body>
        <main className="app">
          <div className="page">
            <div className="blank">
              <p className="blank__title">Something Went Wrong</p>
              <p className="blank__text">
                The app could not start. Trying again usually works.
              </p>
              <div className="blank__actions">
                <button className="btn" type="button" onClick={reset}>
                  Try Again
                </button>
              </div>
              {error.message ? <p className="blank__note">{error.message}</p> : null}
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
