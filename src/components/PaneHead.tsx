/**
 * The head every pane of rows wears: what it holds, how much of it the search
 * and the filters have left, and whatever one control that pane puts beside it.
 *
 * Both designs draw it, so the count is worded and placed the same way in each.
 */
export default function PaneHead({
  shown,
  total,
  children,
}: {
  /** How many rows are on screen. */
  shown: number;
  /** How many the board holds in all. */
  total: number;
  children?: React.ReactNode;
}) {
  return (
    <header className="pane__head">
      {/* A div rather than a span: a heading is flow content, and a span
          holding one is invalid even where a browser tolerates it. */}
      <div className="textline">
        <h2 className="pane__title">Applications</h2>
        <span className="pane__count">{shown === total ? total : `${shown} of ${total}`}</span>
      </div>
      {children}
    </header>
  );
}
