import Link from "next/link";
import { Compass } from "lucide-react";

/**
 * There is one page, so every other path lands here rather than on the
 * framework's own 404.
 */
export default function NotFound() {
  return (
    <main className="app" role="application" aria-label="Internship Applications Tracker">
      <div className="page">
        <div className="blank">
          <span className="blank__icon">
            <Compass className="lucide" />
          </span>
          <p className="blank__title">Nothing Here</p>
          <p className="blank__text">This app has one page, and it is the board.</p>
          <div className="blank__actions">
            <Link className="btn" href="/">
              Back to the Board
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
