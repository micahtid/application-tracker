import type { gmail_v1 } from "googleapis";

/**
 * Walking the MIME tree and cleaning what comes out (D5, "Fetching details").
 * Everything worth extracting sits near the top of an email; the bottom is
 * footers, legal text and unsubscribe links, and "Powered by Greenhouse" down
 * there is how the model ends up thinking the employer is Greenhouse.
 */

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

type Part = gmail_v1.Schema$MessagePart;

function collectParts(part: Part | undefined, mimeType: string, out: string[]): void {
  if (!part) return;
  if (part.mimeType === mimeType && part.body?.data) out.push(decodeBase64Url(part.body.data));
  for (const child of part.parts ?? []) collectParts(child, mimeType, out);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|table|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#\d+;/g, " ");
}

const QUOTE_MARKERS = [
  /^On .{0,120}\bwrote:$/im,
  /^-{2,}\s*Original Message\s*-{2,}$/im,
  /^_{5,}$/m,
  /^From:\s.+$/im,
];

const TRAILING_NOISE = [
  /unsubscribe/i,
  /view (this|the) (email|message) in your browser/i,
  /this (e-?mail|message) (and any attachments )?(is|are) (confidential|intended)/i,
  /©\s?\d{4}/,
  /all rights reserved/i,
  /powered by/i,
  /sent (from|via|by) /i,
  /privacy policy/i,
  /update your (email )?preferences/i,
  /do not reply to this (e-?mail|message)/i,
];

/** Strips quoted replies, signatures, navigation blocks and tracking junk. */
export function cleanBody(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n");

  // Drop anything from the first quoted-reply marker onwards.
  for (const marker of QUOTE_MARKERS) {
    const hit = text.match(marker);
    if (hit?.index !== undefined) text = text.slice(0, hit.index);
  }

  // Link-only lines, tracking pixels and bare URLs carry no meaning here.
  text = text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\[image:[^\]]*\]/gi, " ")
    .replace(/[ \t\u00a0]+/g, " ");

  const lines = text.split("\n").map((line) => line.trim());

  // HTML mail often opens with a navigation block: a run of short link labels
  // before any real sentence. Skip that run, but only when a real sentence
  // turns up soon after, so a genuinely terse email is never emptied.
  let start = 0;
  while (start < lines.length && lines[start].length < 3) start += 1;

  const PROSE = /[a-z]{3,}\s+[a-z]{3,}/i;
  const isProse = (line: string) => line.length >= 25 && PROSE.test(line);

  let prose = start;
  while (prose < lines.length && prose - start < 12 && !isProse(lines[prose])) prose += 1;
  if (prose < lines.length && prose - start < 12) start = prose;

  const kept: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (TRAILING_NOISE.some((pattern) => pattern.test(line))) break;
    kept.push(line);
  }

  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Prefers text/plain, falls back to converted HTML, then cleans the result. */
export function extractBody(payload: Part | undefined): string {
  const plain: string[] = [];
  collectParts(payload, "text/plain", plain);

  if (!plain.length && payload?.body?.data && payload.mimeType === "text/plain") {
    plain.push(decodeBase64Url(payload.body.data));
  }

  if (plain.length) return cleanBody(plain.join("\n"));

  const html: string[] = [];
  collectParts(payload, "text/html", html);
  if (!html.length && payload?.body?.data) html.push(decodeBase64Url(payload.body.data));

  return cleanBody(htmlToText(html.join("\n")));
}

export function headerValue(payload: Part | undefined, name: string): string | null {
  const header = payload?.headers?.find(
    (candidate) => candidate.name?.toLowerCase() === name.toLowerCase(),
  );
  return header?.value ?? null;
}

/** "Acme Recruiting <no-reply@acme.com>" becomes its three parts. */
export function parseSender(from: string | null): {
  name: string | null;
  email: string | null;
  domain: string | null;
} {
  if (!from) return { name: null, email: null, domain: null };

  const angled = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  const name = angled ? angled[1].replace(/^"|"$/g, "").trim() || null : null;
  const email = (angled ? angled[2] : from).trim().toLowerCase();
  const domain = email.includes("@") ? email.split("@").pop()!.trim() : null;

  return { name, email: email || null, domain: domain || null };
}
