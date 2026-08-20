import { atsForDomain } from "@/lib/ats";

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
 * The title a line reads, which is the model's answer with one thing added
 * (LOOP2 3.5).
 *
 * The stored titles are already uniform, and what they never say is *whose*
 * assessment: the model reads one email at a time and has no idea another
 * vendor sent a different exam to the same person. An exam vendor's name is
 * the useful part of that email, so it goes in front.
 *
 * A platform is never named. It sends on the employer's behalf, the row shows
 * it as a chip already, and its name would be noise on every line.
 *
 * Worked out here rather than stored, so it costs nothing and overwrites no
 * value the model gave. The stored answer stays exactly as it came back, which
 * is what lets a reclassification still be scored against it.
 */
export function drawerTitle(message: DrawerMessage): string {
  const title = message.emailTitle ?? "Application Email";
  const ats = atsForDomain(message.senderDomain);
  if (!ats || ats.kind !== "ASSESSMENT") return title;
  if (title.toLowerCase().includes(ats.vendor.toLowerCase())) return title;
  return `${ats.vendor} ${title}`;
}

/** Every email the drawer shows, at either level. */
export function shownIn<T extends DrawerMessage>(tree: DrawerNode<T>[]): T[] {
  return tree.flatMap((node) => [node.message, ...node.children.map((child) => child.message)]);
}
