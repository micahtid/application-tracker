import {
  OUTCOME_LABELS,
  STAGE_LABELS,
  type EmailEvent,
  type Outcome,
  type StageDetail,
  type Status,
} from "@/lib/constants";
import { classificationOf } from "@/lib/pipeline/recompute";

/**
 * What a row's drawer shows, worked out in one place.
 *
 * The board and the loop harness both need this answer. Answered separately,
 * the harness would score its own copy of the rule, so a display change could
 * improve the score and change nothing a person sees.
 */

/** The fields the shape of a drawer is worked out from. Nothing else is read. */
export type DrawerMessage = {
  id: number;
  gmailMessageId: string;
  emailTitle: string | null;
  receivedAt: Date;
  senderDomain: string | null;
  isSignificant: boolean | null;
  isApplicationRelated: boolean | null;
  llmClassificationRaw: string | null;
  parentMessageId: number | null;
  parentRelation: string | null;
};

export type DrawerNode<T extends DrawerMessage> = {
  message: T;
  relation: string | null;
  children: DrawerNode<T>[];
};

/** Oldest first, with the row id breaking a dead heat, as everywhere else. */
export function byReceived<T extends DrawerMessage>(a: T, b: T): number {
  return a.receivedAt.getTime() - b.receivedAt.getTime() || a.id - b.id;
}

/**
 * Every email an application owns appears in its drawer (LOOP2 Invariant 4).
 *
 * Nothing is filtered here. A reminder and a completion notice are neither
 * milestones nor noise: they are reports on an event already on the board, and
 * the shape for that is a parent rather than a flag. The nesting is read off
 * `parent_message_id`, which stage 5 worked out from the whole set, so this
 * only arranges what it is given.
 */
export function drawerTree<T extends DrawerMessage>(messages: T[]): DrawerNode<T>[] {
  const related = [...messages].filter((message) => message.isApplicationRelated).sort(byReceived);

  const lines = new Map<number, DrawerNode<T>>();
  for (const message of related) {
    if (message.parentMessageId === null) lines.set(message.id, { message, relation: null, children: [] });
  }

  const top = [...lines.values()];
  for (const message of related) {
    if (message.parentMessageId === null) continue;
    const node: DrawerNode<T> = { message, relation: message.parentRelation, children: [] };
    const parent = lines.get(message.parentMessageId);
    // A parent outside this set cannot happen while parents are chosen inside
    // one application, but losing an email would be worse than showing it a
    // level too high, so it is shown rather than dropped.
    if (parent) parent.children.push(node);
    else top.push(node);
  }

  return top.sort((a, b) => byReceived(a.message, b.message));
}

/**
 * Every branch of the display that decides something by searching the model's
 * freeform title for a word (LOOP3 P1).
 *
 * Empty, and kept empty: each of the five it once held was a guess in English
 * at a fact the model had already answered. `title.keyword_rules` counts this
 * list on every scored run, so a branch that came back would show up the same
 * day.
 */
export const TITLE_KEYWORD_RULES: { name: string; pattern: RegExp }[] = [];

/**
 * The words a line is built from, and the whole vocabulary a drawer can say.
 *
 * A line is two halves: what the email is about, and what kind of report it
 * is. Both are answers the model gave, so no wording is read here, in any
 * language.
 */
/**
 * The badge wording, except that a drawer line says "Technical Assessment"
 * where the badge has room only for "Assessment". Everything else matches, and
 * a stage added to the list is worded here without a second edit.
 */
const STAGE_WORDS: Record<StageDetail, string> = {
  ...STAGE_LABELS,
  ASSESSMENT: "Technical Assessment",
};

const EVENT_WORDS: Record<EmailEvent, string> = {
  CONFIRMATION: "Confirmation",
  INVITATION: "Invitation",
  REMINDER: "Reminder",
  COMPLETION: "Completed",
  REQUEST: "Request",
  CANCELLATION: "Cancelled",
  DECISION: "Decision",
  UPDATE: "Update",
};

/**
 * Rung 2 of the ladder: the email asks for nothing the vocabulary can name, so
 * the line is composed from the status and the event alone (LOOP3 Decision 7).
 */
const WITHOUT_STAGE: Record<EmailEvent, string> = {
  CONFIRMATION: "Application Confirmation",
  INVITATION: "Application Invitation",
  REMINDER: "Application Reminder",
  COMPLETION: "Application Completed",
  REQUEST: "Information Request",
  CANCELLATION: "Step Cancelled",
  DECISION: "Application Update",
  UPDATE: "Application Update",
};

/** The same, for a row that has an offer. */
const OFFER: Partial<Record<EmailEvent, string>> = {
  DECISION: "Offer",
  CONFIRMATION: "Offer Confirmation",
  REMINDER: "Offer Reminder",
};

/**
 * An application that has ended, when nothing says which ending it was.
 *
 * A rejection, an application the person withdrew, and a posting the employer
 * cancelled are all stored REJECTED, because all three really did end. Only the
 * first is a rejection, and a line reading "rejection" on the other two says
 * something that did not happen.
 *
 * LOOP3 made this the answer for all three, which was right for the display and
 * left the stored value still saying one word for three things. LOOP4 gave the
 * model an `outcome` to answer, so this stops being a compromise and becomes
 * what it always should have been: the fallback, said when the ending is not
 * known, and never instead of an ending that is.
 */
const CLOSED = "Application Closed";

/**
 * One standard title, composed from what the model answered about the email
 * rather than from what it called it (LOOP3 Decision 1 and 7).
 *
 * The model titles each email in that email's own words, which is how one
 * mailbox ends up with "Application Received", "Application Complete" and
 * "Application Confirmation" for the same event. Each is right on its own.
 * Only the whole board can see they are one thing.
 *
 * The ladder never guesses:
 *
 *   1. stage and event both known   the standard phrase, composed from them
 *   2. event known, stage not       composed from the status and the event
 *   3. neither known                the model's own title, shown as written
 *
 * Rung 3 is the only place a freeform string reaches the screen, and it
 * decides nothing. It is reached only for an answer given before either field
 * existed.
 */
export function drawerTitle(message: DrawerMessage): string {
  const said = classificationOf(message);
  const status = said?.status ?? "APPLIED";
  const stage = said?.stageDetail ?? null;
  const event = said?.emailEvent ?? null;

  if (!stage && !event) return message.emailTitle ?? "Application Email";

  const title = compose(status, stage, event ?? "UPDATE", said?.outcome ?? null);

  /**
   * A resend says nothing new, and says which kind of nothing (LOOP3 Decision
   * 4). A resent receipt reminds you of nothing, so calling it a reminder
   * would invent an obligation. A resent invitation is not literally a
   * reminder either, but it answers the reader's question the same way: no,
   * nothing new, and the thing above is still waiting.
   */
  if (message.parentRelation === "REPEAT") {
    const asked = event === "INVITATION" || event === "REQUEST";
    return asked ? compose(status, stage, "REMINDER", null) : `Duplicate ${title}`;
  }

  return title;
}

function compose(
  status: Status,
  stage: StageDetail | null,
  event: EmailEvent,
  outcome: Outcome | null,
): string {
  // An ending said in the email's own terms beats every phrase composed below
  // it, because those are all worked out from a status that says one word for
  // several different endings (LOOP4 Decision 7).
  if (outcome) return OUTCOME_LABELS[outcome];

  // A step that has stopped is not a decision about the applicant, so it is
  // said as what it is rather than folded into an outcome.
  if (event === "CANCELLATION") return stage ? `${STAGE_WORDS[stage]} Cancelled` : "Step Cancelled";

  // An outcome is about the application, not about a stage of it, so a
  // decision at either end wins over whatever step was in flight.
  if (event === "DECISION" && status === "REJECTED") return CLOSED;
  if (event === "DECISION" && status === "ACCEPTED") return "Offer";

  if (stage) return `${STAGE_WORDS[stage]} ${EVENT_WORDS[event]}`;
  if (status === "REJECTED") return CLOSED;
  if (status === "ACCEPTED") return OFFER[event] ?? "Offer Update";
  return WITHOUT_STAGE[event];
}
/** Every email the drawer shows, at either level. */
export function shownIn<T extends DrawerMessage>(tree: DrawerNode<T>[]): T[] {
  return tree.flatMap((node) => [node.message, ...node.children.map((child) => child.message)]);
}
