/**
 * A hand run check of stages 4 and 5 against made up emails.
 *
 * It exists for the one quality that cannot be seen by looking at the board:
 * running everything again must produce the same applications (PRD 7). It uses
 * a throwaway database, so your real one is never touched, and it never calls
 * Gmail or a model.
 *
 *   npm run check:pipeline
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DB = path.join(process.cwd(), "prisma", "check.db");
process.env.DATABASE_URL = "file:./check.db";

for (const suffix of ["", "-journal"]) {
  if (fs.existsSync(DB + suffix)) fs.rmSync(DB + suffix);
}
execSync("npx prisma migrate deploy", { stdio: "ignore", env: process.env });

const { prisma } = await import("../src/lib/db");
const { attachClassified } = await import("../src/lib/pipeline/match");
const { recomputeAll } = await import("../src/lib/pipeline/recompute");
const { CLASSIFIER_VERSION } = await import("../src/lib/constants");

type Fixture = {
  day: string;
  thread: string;
  sender: string;
  subject: string;
  company: string | null;
  role: string | null;
  season?: string | null;
  year?: number | null;
  status: string;
  stage?: string | null;
  significant: boolean;
  title: string;
};

const FIXTURES: Fixture[] = [
  // Two emails from the same company, classified in one batch. Before matching
  // became its own serial pass, these produced two Amazon rows.
  { day: "2026-01-10", thread: "t1", sender: "no-reply@greenhouse.io", subject: "Thank you for applying", company: "Amazon", role: "SDE Intern", season: "Summer", year: 2027, status: "APPLIED", significant: true, title: "Application Confirmation" },
  { day: "2026-01-11", thread: "t2", sender: "recruiting@amazon.com", subject: "Online assessment", company: "Amazon", role: "SDE Intern", status: "IN_PROGRESS", stage: "ASSESSMENT", significant: true, title: "Online Assessment Invite" },

  // A rejection that arrives after an interview has to win on date alone.
  { day: "2026-01-05", thread: "t3", sender: "no-reply@lever.co", subject: "Application received", company: "Stripe", role: "Backend Engineering Intern", season: "Summer", year: 2027, status: "APPLIED", significant: true, title: "Application Received" },
  { day: "2026-02-01", thread: "t4", sender: "people@stripe.com", subject: "Interview", company: "Stripe", role: "Backend Engineering Intern", status: "IN_PROGRESS", stage: "INTERVIEW", significant: true, title: "Interview Invitation" },
  { day: "2026-02-20", thread: "t5", sender: "people@stripe.com", subject: "Update on your application", company: "Stripe", role: "Backend Engineering Intern", status: "REJECTED", significant: true, title: "Application Update" },

  // A scheduling reply. Saved and linked, but it writes no status, so it must
  // not drag the row back to Applied.
  { day: "2026-02-25", thread: "t5", sender: "people@stripe.com", subject: "Re: Update", company: null, role: null, status: "APPLIED", significant: false, title: "Scheduling Reply" },

  // The oldest email names no role, so the row shows only the company.
  { day: "2026-01-02", thread: "t6", sender: "careers@figma.com", subject: "We got your portfolio", company: "Figma", role: null, status: "APPLIED", significant: true, title: "Portfolio Received" },
  { day: "2026-03-02", thread: "t7", sender: "careers@figma.com", subject: "Offer", company: "Figma", role: "Product Design Intern", status: "ACCEPTED", significant: true, title: "Offer Letter" },

  // Legal endings and a leading The must not split one company into two rows.
  { day: "2026-01-20", thread: "t8", sender: "no-reply@ashbyhq.com", subject: "Thanks for applying", company: "Acme Inc.", role: "Data Intern", status: "APPLIED", significant: true, title: "Application Confirmation" },
  { day: "2026-02-10", thread: "t9", sender: "hiring@acme.com", subject: "Next steps", company: "The Acme", role: "Data Intern", status: "IN_PROGRESS", stage: "INTERVIEW", significant: true, title: "Recruiter Screen" },

  // No company at all and no thread to lean on: classified, and attached to
  // nothing.
  { day: "2026-02-11", thread: "t10", sender: "unknown@example.com", subject: "Re: your application", company: null, role: null, status: "APPLIED", significant: true, title: "Reply" },
];

async function seed() {
  const account = await prisma.gmailAccount.create({
    data: { emailAddress: "check@example.com", refreshToken: "none", displayName: "Check" },
  });

  await Promise.all(
    FIXTURES.map((fixture, index) =>
      prisma.emailMessage.create({
        data: {
          gmailAccountId: account.id,
          gmailMessageId: `m${index}`,
          threadId: fixture.thread,
          senderEmail: fixture.sender,
          senderDomain: fixture.sender.split("@")[1],
          subject: fixture.subject,
          bodyText: fixture.subject,
          receivedAt: new Date(`${fixture.day}T12:00:00Z`),
          classificationStatus: "OK",
          classifierVersion: CLASSIFIER_VERSION,
          llmModel: "fixture",
          isApplicationRelated: true,
          isSignificant: fixture.significant,
          emailTitle: fixture.title,
          llmClassificationRaw: JSON.stringify({
            is_application_related: true,
            company_name: fixture.company,
            company_domain: null,
            role_title: fixture.role,
            season: fixture.season ?? null,
            year: fixture.year ?? null,
            status: fixture.status,
            stage_detail: fixture.stage ?? null,
            is_significant: fixture.significant,
            email_title: fixture.title,
            confidence_score: 0.9,
            summary: fixture.subject,
          }),
        },
      }),
    ),
  );
}

async function snapshot() {
  const applications = await prisma.application.findMany({
    orderBy: [{ companyName: "asc" }, { id: "asc" }],
    include: { messages: { select: { gmailMessageId: true }, orderBy: { receivedAt: "asc" } } },
  });

  return applications.map((application) => ({
    company: application.companyName,
    role: application.roleTitle,
    season: application.season,
    year: application.year,
    status: application.status,
    stage: application.stageDetail,
    ats: application.atsVendor,
    emails: application.messages.map((message) => message.gmailMessageId),
  }));
}

async function runPipeline() {
  const matched = await attachClassified();
  await recomputeAll(matched.touched);
}

const expectations: [string, boolean][] = [];
function expect(label: string, condition: boolean) {
  expectations.push([label, condition]);
}

await seed();
await runPipeline();
const first = await snapshot();

// Running the whole pipeline again over an untouched mailbox must produce
// identical applications.
await runPipeline();
const second = await snapshot();

const unattached = await prisma.emailMessage.count({ where: { applicationId: null } });

console.log(JSON.stringify(first, null, 2));

expect("four applications", first.length === 4);
expect("running it again changes nothing", JSON.stringify(first) === JSON.stringify(second));
expect(
  "two emails from one company make one row",
  first.filter((row) => row.company === "Amazon").length === 1,
);
expect(
  "a rejection after an interview wins",
  first.find((row) => row.company === "Stripe")?.status === "REJECTED",
);
expect(
  "a scheduling reply is linked but writes no status",
  first.find((row) => row.company === "Stripe")?.emails.length === 4,
);
expect(
  "identity comes from the oldest email",
  first.find((row) => row.company === "Figma")?.role === null,
);
expect(
  "state comes from the newest significant email",
  first.find((row) => row.company === "Figma")?.status === "ACCEPTED",
);
expect(
  "Inc and a leading The normalise to one company",
  first.filter((row) => (row.company ?? "").toLowerCase().includes("acme")).length === 1,
);
expect(
  "the stage badge follows the newest significant email",
  first.find((row) => row.company === "Amazon")?.stage === "ASSESSMENT",
);
expect("the ATS vendor is picked up from the sender", first.some((row) => row.ats === "Greenhouse"));
expect("an email with no company creates no application", unattached === 1);

let failures = 0;
for (const [label, ok] of expectations) {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
}

await prisma.$disconnect();
process.exit(failures ? 1 : 0);
