import type { EmailEvent, StageDetail, Status } from "@/lib/constants";
import { classificationOf } from "@/lib/pipeline/recompute";

/**
 * What a row's drawer shows, worked out in one place (PRD 5.3).
 *
 * The board and the loop harness both have to answer "which emails does this
 * row show, and under what". If they answered it separately the harness would
 * be scoring its own copy of the rule rather than the one the board uses, so a
 * display change could improve the score and change nothing a person sees.
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
 * The old rule was a yes or no: significant, or hidden. That forced every email
 * to be either a milestone or nothing, and a reminder is neither, and a
 * completion notice is neither. They are reports on an event already on the
 * board, and the honest shape for that is not a flag but a parent.
 *
 * So nothing is filtered here. The nesting is read off `parent_message_id`,
 * which stage 5 worked out from the whole set, and this function only arranges
 * what it is given.
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
 * Empty, and kept empty. It held five branches until iteration 2 of LOOP3, and
 * every one of them was a guess in English at a fact the model had already
 * worked out. `title.keyword_rules` counts this list on every scored run, so a
 * branch that came back would have to join it and would be visible on the
 * scorecard the same day.
 */
export const TITLE_KEYWORD_RULES: { name: string; pattern: RegExp }[] = [];

/**
 * The words a line is built from, and the whole vocabulary a drawer can say.
 *
 * A line is two halves: what the email is about, and what kind of report it
 * is. Both are answers the model gave, so no wording is read here, in any
 * language. That is the whole of LOOP3 P1: the display used to search the
 * model's freeform title for English words like "reminder" and "complet",
 * which was a guess at a fact already known, made in one language, tuned
 * against the titles one mailbox happened to hold.
 */
const STAGE_WORDS: Record<StageDetail, string> = {
  ASSESSMENT: "Technical Assessment",
  RECORDED_INTERVIEW: "Recorded Interview",
  INTERVIEW: "Interview",
  VERIFICATION: "Verification",
};

const EVENT_WORDS: Record<EmailEvent, string> = {
  CONFIRMATION: "Confirmation",
  INVITATION: "Invitation",
  REMINDER: "Reminder",
  COMPLETION: "Completed",
  REQUEST: "Request",
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
 * An application that has ended, however it ended.
 *
 * A rejection, an application the person withdrew, and a posting the employer
 * cancelled are all stored REJECTED, because all three really did end. Only
 * the first is a rejection, and a line reading "rejection" on the other two
 * says something that did not happen. The section header already says the row
 * is closed, so nothing is lost by saying only what all three share.
 */
const CLOSED = "Application Closed";

/**
 * One standard title, composed from what the model answered about the email
 * rather than read out of what it called it (LOOP3 Decision 1 and 7).
 *
 * The model reads one email at a time and titles it in whatever words that one
 * email used, which is how a single mailbox comes to hold "Application
 * Received", "Application Complete" and "Application Confirmation" for the
 * same event. Read on its own every one of those titles is right. Only the
 * whole board can see they are one thing.
 *
 * The ladder never guesses:
 *
 *   1. stage and event both known   the standard phrase, composed from them
 *   2. event known, stage not       composed from the status and the event
 *   3. neither known                the model's own title, shown as written
 *
 * Rung 3 is the only place a freeform string reaches the screen, and it
 * decides nothing: it is reached only when both enums are empty, which is an
 * answer given before either field existed. For an email nothing recognises,
 * the alternative is a standard phrase that is confidently wrong or a generic
 * one that says nothing, and the model did read the email.
 */
export function drawerTitle(message: DrawerMessage): string {
  const said = classificationOf(message);
  const status = said?.status ?? "APPLIED";
  const stage = said?.stageDetail ?? null;
  const event = said?.emailEvent ?? null;

  if (!stage && !event) return message.emailTitle ?? "Application Email";

  const title = compose(status, stage, event ?? "UPDATE");

  /**
   * A resend says nothing new, and says which kind of nothing (LOOP3 Decision
   * 4). Six of the nine on this board repeat a receipt for something already
   * done, and there is nothing to be reminded of, so calling them reminders
   * would invent an obligation.
   *
   * A resent invitation is not literally a reminder either: the employer sent
   * the same notice twice and nobody wrote a nudge. It reads as one anyway,
   * because the reader's question is "is there anything new here for me to
   * do", and the honest answer is the same as a reminder's. No, but the thing
   * above is still waiting.
   */
  if (message.parentRelation === "REPEAT") {
    const asked = event === "INVITATION" || event === "REQUEST";
    return asked ? compose(status, stage, "REMINDER") : `Duplicate ${title}`;
  }

  return title;
}

function compose(status: Status, stage: StageDetail | null, event: EmailEvent): string {
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
