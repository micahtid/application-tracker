import { Inbox } from "lucide-react";

/**
 * What stands where the rows would have been.
 *
 * Both designs show it, in the same place: the body of whichever pane the rows
 * were going to fill. Which of the three lines it is depends on why there is
 * nothing, because "no match" and "nothing tracked yet" are different problems
 * and only one of them has anything to do with what you typed.
 */
export default function NoResults({ query, narrowed }: { query: string; narrowed: boolean }) {
  return (
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
  );
}
