/**
 * A deep link to one message in Gmail.
 *
 * The account is named rather than using /u/0/, because u/0 is whichever Google
 * account signed into that browser first, which is often not this mailbox.
 */
export function gmailLink(accountEmail: string | null, gmailMessageId: string): string {
  const authuser = accountEmail ? encodeURIComponent(accountEmail) : "";
  return `https://mail.google.com/mail/u/?authuser=${authuser}#all/${gmailMessageId}`;
}
