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
  // became its own serial pass, these produced two rows for one employer.
  { day: "2026-01-10", thread: "t1", sender: "no-reply@greenhouse.io", subject: "Thank you for applying", company: "Aperture Logistics", role: "SDE Intern", season: "Summer", year: 2027, status: "APPLIED", significant: true, title: "Application Confirmation" },
  { day: "2026-01-11", thread: "t2", sender: "recruiting@aperture.example", subject: "Online assessment", company: "Aperture Logistics", role: "SDE Intern", status: "IN_PROGRESS", stage: "ASSESSMENT", significant: true, title: "Online Assessment Invite" },

  // A rejection that arrives after an interview has to win on date alone.
  { day: "2026-01-05", thread: "t3", sender: "no-reply@lever.co", subject: "Application received", company: "Massive Dynamic", role: "Backend Engineering Intern", season: "Summer", year: 2027, status: "APPLIED", significant: true, title: "Application Received" },
  { day: "2026-02-01", thread: "t4", sender: "people@massivedynamic.example", subject: "Interview", company: "Massive Dynamic", role: "Backend Engineering Intern", status: "IN_PROGRESS", stage: "INTERVIEW", significant: true, title: "Interview Invitation" },
  { day: "2026-02-20", thread: "t5", sender: "people@massivedynamic.example", subject: "Update on your application", company: "Massive Dynamic", role: "Backend Engineering Intern", status: "REJECTED", significant: true, title: "Application Update" },

  // A scheduling reply. Saved and linked, but it writes no status, so it must
  // not drag the row back to Applied.
  { day: "2026-02-25", thread: "t5", sender: "people@massivedynamic.example", subject: "Re: Update", company: null, role: null, status: "APPLIED", significant: false, title: "Scheduling Reply" },

  // Invariant: an identity field comes from the oldest email that states it.
  // The oldest email here names no role, and the later one does, so the row
  // shows the role. Saying nothing is not disagreeing.
  { day: "2026-01-02", thread: "t6", sender: "careers@cyberdyne.example", subject: "We got your portfolio", company: "Cyberdyne", role: null, status: "APPLIED", significant: true, title: "Portfolio Received" },
  { day: "2026-03-02", thread: "t7", sender: "careers@cyberdyne.example", subject: "Offer", company: "Cyberdyne", role: "Product Design Intern", status: "ACCEPTED", significant: true, title: "Offer Letter" },

  // Legal endings and a leading The must not split one company into two rows.
  { day: "2026-01-20", thread: "t8", sender: "no-reply@ashbyhq.com", subject: "Thanks for applying", company: "Acme Inc.", role: "Data Intern", status: "APPLIED", significant: true, title: "Application Confirmation" },
  { day: "2026-02-10", thread: "t9", sender: "hiring@acme.example", subject: "Next steps", company: "The Acme", role: "Data Intern", status: "IN_PROGRESS", stage: "INTERVIEW", significant: true, title: "Recruiter Screen" },

  // No company at all and no thread to lean on: classified, and attached to
  // nothing.
  { day: "2026-02-11", thread: "t10", sender: "unknown@example.com", subject: "Re: your application", company: null, role: null, status: "APPLIED", significant: true, title: "Reply" },

  // Invariant: a thread is evidence, not proof. Mail clients thread by
  // subject, so two applications acknowledged in the same words land in one
  // thread. Naming a different job makes it a different application.
  { day: "2026-01-15", thread: "t11", sender: "jobs@northwind.example", subject: "Thanks for applying", company: "Northwind", role: "Robotics Engineer Intern", status: "APPLIED", significant: true, title: "Application Confirmation" },
  { day: "2026-01-15", thread: "t11", sender: "jobs@northwind.example", subject: "Thanks for applying", company: "Northwind", role: "Payroll Analyst Intern", status: "APPLIED", significant: true, title: "Application Confirmation" },

  // Invariant: role comparison is symmetric. These two share only two words
  // and each carries several the other does not, so they are two postings.
  // Measured against the shorter title they would score exactly at the
  // threshold and merge.
  { day: "2026-01-25", thread: "t12", sender: "careers@contoso.example", subject: "We received your application", company: "Contoso Bank", role: "Code for Good Hackathon, Software Engineer Program, United States", status: "APPLIED", significant: true, title: "Application Confirmation" },
  { day: "2026-01-26", thread: "t13", sender: "careers@contoso.example", subject: "We received your application", company: "Contoso Bank", role: "Data for Good Hackathon, Data and AI Program", status: "APPLIED", significant: true, title: "Application Confirmation" },

  // Invariant: two postings numbered differently are two applications. The
  // title is word for word the same, which is exactly the case no comparison
  // of titles can ever get right.
  { day: "2026-02-05", thread: "t14", sender: "careers@fabrikam.example", subject: "Thank you for your application (Job number: 778001)", company: "Fabrikam", role: "Software Engineer Intern", status: "APPLIED", significant: true, title: "Application Confirmation" },
  { day: "2026-02-06", thread: "t15", sender: "careers@fabrikam.example", subject: "Thank you for your application (Job number: 778002)", company: "Fabrikam", role: "Software Engineer Intern", status: "APPLIED", significant: true, title: "Application Confirmation" },

  // ... and two emails quoting the same number stay one application, however
  // differently the two are worded.
  { day: "2026-02-07", thread: "t16", sender: "careers@tailspin.example", subject: "Application received, requisition 990123", company: "Tailspin", role: "Analytics Intern", status: "APPLIED", significant: true, title: "Application Confirmation" },
  { day: "2026-02-09", thread: "t17", sender: "careers@tailspin.example", subject: "Next steps for req 990123", company: "Tailspin", role: "Business Insight Placement", status: "IN_PROGRESS", stage: "INTERVIEW", significant: true, title: "Recruiter Screen" },
  // Invariant: two names mean one employer when one is a token subset of the
  // other, or when they are the same with the spaces taken out. The role
  // comparison is still what decides, so a shared first word merges nothing
  // on its own.
  { day: "2026-03-10", thread: "t18", sender: "careers@globex.example", subject: "Application received", company: "Globex", role: "Platform Engineer Intern", status: "APPLIED", significant: true, title: "Application Confirmation" },
  { day: "2026-03-11", thread: "t19", sender: "careers@globex.example", subject: "Assessment", company: "Globex Industries", role: "Platform Engineer Internship", status: "IN_PROGRESS", stage: "ASSESSMENT", significant: true, title: "Online Assessment Invite" },

  { day: "2026-03-12", thread: "t20", sender: "careers@umbrella.example", subject: "Application received", company: "Umbrella Systems", role: "Network Intern", status: "APPLIED", significant: true, title: "Application Confirmation" },
  { day: "2026-03-13", thread: "t21", sender: "careers@umbrella.example", subject: "Next steps", company: "UmbrellaSystems", role: "Network Intern", status: "IN_PROGRESS", stage: "INTERVIEW", significant: true, title: "Recruiter Screen" },

  // A dangling connector left behind by a removed legal ending is not part of
  // anybody name, so these two are one employer too.
  { day: "2026-03-14", thread: "t22", sender: "careers@initech.example", subject: "Application received", company: "Initech & Co.", role: "Systems Intern", status: "APPLIED", significant: true, title: "Application Confirmation" },
  { day: "2026-03-15", thread: "t23", sender: "careers@initech.example", subject: "Next steps", company: "Initech", role: "Systems Intern", status: "IN_PROGRESS", stage: "INTERVIEW", significant: true, title: "Recruiter Screen" },

  // Two employers sharing a first word are still two employers.
  { day: "2026-03-16", thread: "t24", sender: "careers@vertexlabs.example", subject: "Application received", company: "Vertex Labs", role: "Chemistry Intern", status: "APPLIED", significant: true, title: "Application Confirmation" },
  { day: "2026-03-17", thread: "t25", sender: "careers@vertexrobotics.example", subject: "Application received", company: "Vertex Robotics", role: "Mechanical Intern", status: "APPLIED", significant: true, title: "Application Confirmation" },
  // Invariant: the row shows the name the employer used most often, not the
  // name that happened to arrive first.
  { day: "2026-04-01", thread: "t26", sender: "careers@wonka.example", subject: "Application received", company: "Wonka", role: "Confection Intern", status: "APPLIED", significant: true, title: "Application Confirmation" },
  { day: "2026-04-02", thread: "t27", sender: "careers@wonka.example", subject: "Assessment", company: "Wonka Industries", role: "Confection Intern", status: "IN_PROGRESS", stage: "ASSESSMENT", significant: true, title: "Online Assessment Invite" },
  { day: "2026-04-03", thread: "t28", sender: "careers@wonka.example", subject: "Next steps", company: "Wonka Industries", role: "Confection Intern", status: "IN_PROGRESS", stage: "INTERVIEW", significant: true, title: "Recruiter Screen" },
  // Invariant: an email carrying the same state as an earlier one in the same
  // application, and repeating its subject once normalised, records no new
  // milestone. Read on its own each of these really is significant, which is
  // why the model cannot be the one to notice.
  { day: "2026-05-01", thread: "t29", sender: "careers@soylent.example", subject: "Next Steps: Technical Assessment", company: "Soylent Foods", role: "Process Intern", status: "IN_PROGRESS", stage: "ASSESSMENT", significant: true, title: "Assessment Invite" },
  { day: "2026-05-02", thread: "t30", sender: "careers@soylent.example", subject: "Reminder: Next Steps: Technical Assessment", company: "Soylent Foods", role: "Process Intern", status: "IN_PROGRESS", stage: "ASSESSMENT", significant: true, title: "Assessment Invite" },
  { day: "2026-05-03", thread: "t31", sender: "careers@soylent.example", subject: "Next Steps: Technical Assessment", company: "Soylent Foods", role: "Process Intern", status: "IN_PROGRESS", stage: "ASSESSMENT", significant: true, title: "Assessment Invite" },
  // Same subject, different state. Two rounds, two milestones.
  { day: "2026-05-10", thread: "t32", sender: "careers@soylent.example", subject: "Next Steps: Technical Assessment", company: "Soylent Foods", role: "Process Intern", status: "IN_PROGRESS", stage: "INTERVIEW", significant: true, title: "Interview Invite" },
  // Invariant: an acknowledgement of receipt is a floor, not a stage. This one
  // arrives after the interview invitation and must not drag the row back to
  // Applied. A real outcome still wins on date alone, as above.
  { day: "2026-06-01", thread: "t33", sender: "careers@hooli.example", subject: "Application received", company: "Hooli", role: "Search Intern", status: "APPLIED", significant: true, title: "Application Confirmation" },
  { day: "2026-06-05", thread: "t34", sender: "careers@hooli.example", subject: "Interview invitation", company: "Hooli", role: "Search Intern", status: "IN_PROGRESS", stage: "INTERVIEW", significant: true, title: "Interview Invitation" },
  { day: "2026-06-09", thread: "t35", sender: "careers@hooli.example", subject: "Update: application complete", company: "Hooli", role: "Search Intern", status: "APPLIED", significant: true, title: "Application Complete" },
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
    include: {
      messages: { select: { gmailMessageId: true }, orderBy: { receivedAt: "asc" } },
      statusHistory: true,
    },
  });

  return applications.map((application) => ({
    milestones: application.statusHistory.length,
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
  const matched = await attachClassified(prisma);
  await recomputeAll(prisma, matched.touched);
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

expect("nineteen applications", first.length === 19);
expect("running it again changes nothing", JSON.stringify(first) === JSON.stringify(second));
expect(
  "two emails from one company make one row",
  first.filter((row) => row.company === "Aperture Logistics").length === 1,
);
expect(
  "a rejection after an interview wins",
  first.find((row) => row.company === "Massive Dynamic")?.status === "REJECTED",
);
expect(
  "a scheduling reply is linked but writes no status",
  first.find((row) => row.company === "Massive Dynamic")?.emails.length === 4,
);
expect(
  "an identity field comes from the oldest email that states it",
  first.find((row) => row.company === "Cyberdyne")?.role === "Product Design Intern",
);
expect(
  "state comes from the newest significant email",
  first.find((row) => row.company === "Cyberdyne")?.status === "ACCEPTED",
);
expect(
  "Inc and a leading The normalise to one company",
  first.filter((row) => (row.company ?? "").toLowerCase().includes("acme")).length === 1,
);
expect(
  "the stage badge follows the newest significant email",
  first.find((row) => row.company === "Aperture Logistics")?.stage === "ASSESSMENT",
);
expect("the ATS vendor is picked up from the sender", first.some((row) => row.ats === "Greenhouse"));
expect("an email with no company creates no application", unattached === 1);
expect(
  "an acknowledgement after an interview does not move the row back",
  first.find((row) => row.company === "Hooli")?.status === "IN_PROGRESS",
);
expect(
  "a resend of a notice records no new milestone",
  first.find((row) => row.company === "Soylent Foods")?.milestones === 2,
);
expect(
  "the row shows the name the employer used most often",
  first.find((row) => (row.company ?? "").startsWith("Wonka"))?.company === "Wonka Industries",
);
expect(
  "a shorter name and a longer one are one employer",
  first.filter((row) => (row.company ?? "").startsWith("Globex")).length === 1,
);
expect(
  "one word and two words are one employer",
  first.filter((row) => (row.company ?? "").toLowerCase().startsWith("umbrella")).length === 1,
);
expect(
  "a dangling connector is not part of the name",
  first.filter((row) => (row.company ?? "").startsWith("Initech")).length === 1,
);
expect(
  "two employers sharing a first word stay two rows",
  first.filter((row) => (row.company ?? "").startsWith("Vertex")).length === 2,
);
expect(
  "two postings numbered differently make two rows",
  first.filter((row) => row.company === "Fabrikam").length === 2,
);
expect(
  "one posting number keeps two differently worded emails together",
  first.filter((row) => row.company === "Tailspin").length === 1,
);
expect(
  "two postings sharing a few words stay two rows",
  first.filter((row) => row.company === "Contoso Bank").length === 2,
);
expect(
  "one thread carrying two different jobs makes two rows",
  first.filter((row) => row.company === "Northwind").length === 2,
);

let failures = 0;
for (const [label, ok] of expectations) {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
}

await prisma.$disconnect();
process.exit(failures ? 1 : 0);
