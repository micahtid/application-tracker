import { SEASONS, SENDER_ROLES, STATUSES, STAGE_DETAILS, EMAIL_EVENTS, OUTCOMES } from "@/lib/constants";

/**
 * The one output shape, written once. Each provider wants the schema in a
 * slightly different dialect, so both dialects are generated from this list
 * rather than written out twice and allowed to drift.
 */
type Field = {
  name: string;
  type: "string" | "boolean" | "integer" | "number";
  nullable: boolean;
  enum?: readonly string[];
  description: string;
};

export const FIELDS: Field[] = [
  {
    name: "is_application_related",
    type: "boolean",
    nullable: false,
    description:
      "True only when this email is about a job or internship application the recipient submitted: a confirmation, an assessment, an interview, an offer, or a rejection. False for job alerts, adverts, newsletters, and anything else.",
  },
  {
    name: "company_name",
    type: "string",
    nullable: true,
    description:
      "The employer the person applied to, never the applicant tracking system that sent the email. Null when the email does not name the employer.",
  },
  {
    name: "company_domain",
    type: "string",
    nullable: true,
    description: "The employer's own web domain if the email states it, otherwise null.",
  },
  {
    name: "role_title",
    type: "string",
    nullable: true,
    description: "The role applied for, as written in the email. Null when it is not stated.",
  },
  {
    name: "season",
    type: "string",
    nullable: true,
    enum: SEASONS,
    description:
      "The term the internship runs, only when the email says so. Never guessed from the date the email was sent.",
  },
  {
    name: "year",
    type: "integer",
    nullable: true,
    description:
      "The year of that term, only when the email says so. Never guessed from the date the email was sent.",
  },
  {
    name: "status",
    type: "string",
    nullable: false,
    enum: STATUSES,
    description:
      "APPLIED when a submission is acknowledged and nothing more. IN_PROGRESS for any live activity: assessment, recruiter screen, technical round, on site. ACCEPTED when an offer is extended or accepted. REJECTED when declined.",
  },
  {
    name: "stage_detail",
    type: "string",
    nullable: true,
    enum: STAGE_DETAILS,
    description:
      "Which step of the process this email is about, whatever the employer calls it. Answer it whether the email invites the person to that step, nudges them about it, or reports that they have finished it. ASSESSMENT when the step is marked and has right answers: a test, a coding challenge, an aptitude test, a take home, a work sample. RECORDED_INTERVIEW when they answer questions alone, on camera or by recording, and somebody reviews it afterwards. INTERVIEW when the step is scheduled and live with one or more people, however long it runs and whatever it is called. VERIFICATION when something is supplied or consented to and then checked rather than judged: proof of identity, a passcode to continue an application, references, a background or credit or right to work check, a medical, or joining paperwork. Null when the email is about no such step, such as a plain acknowledgement that an application arrived, or an outcome.",
  },
  {
    name: "email_event",
    type: "string",
    nullable: false,
    enum: EMAIL_EVENTS,
    description:
      "What kind of report this email is. CONFIRMATION when something the person submitted has been received and nothing is asked of them. INVITATION when they are asked to do something for the first time. REMINDER when they have already been asked and this repeats the ask. COMPLETION when a step they carried out is finished or has been received. REQUEST when something is needed from them before this can go further. CANCELLATION when something that was already arranged is now not happening, such as an interview called off or a posting put on hold: nothing has been decided about the person, the step has simply stopped. DECISION when it is an outcome in either direction, including an offer, a rejection, or a posting the person has been turned down for. UPDATE for anything else: it is the fallback, so use it whenever none of the others really fits.",
  },
  {
    name: "outcome",
    type: "string",
    nullable: true,
    enum: OUTCOMES,
    description:
      "Which ending the application reached, when this email announces one, and null on every email that announces none. Judged by what happened rather than by how gently it was worded. OFFER_EXTENDED when an offer has been made and the person has not answered it yet. OFFER_ACCEPTED when they have taken it. OFFER_DECLINED when they have turned it down. OFFER_RESCINDED when the employer has taken an offer back. REJECTED_BY_EMPLOYER when the employer is not going ahead with them. WITHDRAWN_BY_APPLICANT when the person pulled out or asked to be withdrawn. POSTING_CANCELLED when the role itself has gone away or been put on hold indefinitely and nobody was turned down. Null when the application has not ended, including for a cancelled interview, which stops a step rather than the application.",
  },
  {
    name: "sender_role",
    type: "string",
    nullable: false,
    enum: SENDER_ROLES,
    description:
      "Who sent this email, judged from the email itself rather than from any list of companies. EMPLOYER when the employer is writing for itself, including through its own careers system. PLATFORM when a hiring or recruiting service is delivering the employer's own mail, such as an application receipt or a rejection sent on the employer's behalf. ASSESSMENT_VENDOR when a third party is running one step for the employer, such as the company whose test, questionnaire, recorded interview or background check the person is being sent to. When it is not clear, answer EMPLOYER.",
  },
  {
    name: "is_significant",
    type: "boolean",
    nullable: false,
    description:
      "True when the email moves the application along: a confirmation, an assessment invite, an interview invite, an offer, a rejection. False for scheduling back and forth, 'thanks, confirming' replies, and automatic replies.",
  },
  {
    name: "email_title",
    type: "string",
    nullable: false,
    description:
      "A short human label for this email, at most six words, such as 'Final Round Invitation' or 'Application Confirmation'.",
  },
  {
    name: "confidence_score",
    type: "number",
    nullable: false,
    description: "How sure you are of this reading, from 0 to 1.",
  },
  {
    name: "summary",
    type: "string",
    nullable: false,
    description: "One sentence saying what the email is, for debugging.",
  },
];

function buildJsonSchema(): Record<string, unknown> {
  const properties: Record<string, unknown> = {};

  for (const field of FIELDS) {
    const base: Record<string, unknown> = { type: field.type, description: field.description };
    if (field.enum) base.enum = [...field.enum];
    properties[field.name] = field.nullable
      ? { anyOf: [base, { type: "null" }], description: field.description }
      : base;
  }

  return {
    type: "object",
    properties,
    required: FIELDS.map((field) => field.name),
    additionalProperties: false,
  };
}

function buildGeminiSchema(): Record<string, unknown> {
  const properties: Record<string, unknown> = {};

  for (const field of FIELDS) {
    const type = { string: "STRING", boolean: "BOOLEAN", integer: "INTEGER", number: "NUMBER" }[
      field.type
    ];
    const property: Record<string, unknown> = { type, description: field.description };
    if (field.enum) property.enum = [...field.enum];
    if (field.nullable) property.nullable = true;
    properties[field.name] = property;
  }

  return {
    type: "OBJECT",
    properties,
    required: FIELDS.filter((field) => !field.nullable).map((field) => field.name),
    propertyOrdering: FIELDS.map((field) => field.name),
  };
}

/**
 * Both dialects are built once at load and handed out unchanged. `FIELDS` never
 * changes while the app runs, so rebuilding either one for every email was the
 * same object every time. Nothing may write to what these return.
 */
const JSON_SCHEMA = buildJsonSchema();
const GEMINI_SCHEMA = buildGeminiSchema();

/** JSON Schema, as Anthropic and OpenRouter want it. */
export function jsonSchema(): Record<string, unknown> {
  return JSON_SCHEMA;
}

/** OpenAPI style, as Gemini's responseSchema wants it. */
export function geminiSchema(): Record<string, unknown> {
  return GEMINI_SCHEMA;
}
