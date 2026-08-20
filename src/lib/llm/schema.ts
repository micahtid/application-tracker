import { SEASONS, STATUSES, STAGE_DETAILS } from "@/lib/constants";

/**
 * The one output shape, written once (3.3). Each provider wants the schema in a
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
      "Only meaningful when status is IN_PROGRESS: ASSESSMENT for a test or coding challenge, INTERVIEW for a conversation with people. Otherwise null.",
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

/** JSON Schema, as Anthropic and OpenRouter want it. */
export function jsonSchema(): Record<string, unknown> {
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

/** OpenAPI style, as Gemini's responseSchema wants it. */
export function geminiSchema(): Record<string, unknown> {
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
