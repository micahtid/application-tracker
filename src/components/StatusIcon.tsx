import { Ban, CircleCheck, Clock, List } from "lucide-react";
import type { Status } from "@/lib/constants";

/**
 * The mark a status wears, in both places one is drawn: the heading over a
 * section of the list, and the status tag at the top of the reading pane.
 *
 * A lookup rather than a branch, so a status added to `STATUSES` cannot leave
 * one of the two drawing something the other does not.
 *
 * It lives beside the components rather than in `@/lib/view` because these are
 * React elements, and nothing on the server has any use for them.
 */
export const STATUS_ICONS: Record<Status, React.ElementType> = {
  ACCEPTED: CircleCheck,
  IN_PROGRESS: Clock,
  APPLIED: List,
  REJECTED: Ban,
};
