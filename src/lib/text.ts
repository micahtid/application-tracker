/**
 * Small formatting helpers, shared by the server and the browser.
 *
 * Every sync note, every progress readout and every correction note builds the
 * same "1 email" against "3 emails" shape, and each one used to write its own
 * ternary inline.
 */

/** A count and its noun, with the plural taken to be the noun plus an s. */
export function plural(count: number, one: string, many = one + "s"): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The verb form that goes with a count, as in `verb(n, "was", "were")`.
 *
 * A separate function rather than a mode on `plural`, because a helper that
 * takes a flag is two helpers sharing one name.
 */
export function verb(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * The calendar day a date falls on, in local terms, with the three parts joined
 * by whatever the caller needs. Gmail search wants slashes and a date input
 * wants dashes, and they are the same three numbers either way.
 */
export function dayString(date: Date, separator: string): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join(separator);
}
