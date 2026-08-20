import { Fragment } from "react";

/** Wraps every search hit in a mark, without handing raw HTML to the DOM. */
export default function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;

  const needle = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (;;) {
    const at = text.toLowerCase().indexOf(needle, cursor);
    if (at === -1) break;
    if (at > cursor) parts.push(text.slice(cursor, at));
    parts.push(<mark key={at}>{text.slice(at, at + needle.length)}</mark>);
    cursor = at + needle.length;
  }

  if (!parts.length) return <>{text}</>;
  parts.push(text.slice(cursor));

  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
    </>
  );
}
