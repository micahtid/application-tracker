/**
 * A hand run check of stages 4 and 5 against made up emails.
 *
 * It exists for the one quality that cannot be seen by looking at the board:
 * running everything again must produce the same applications. It uses
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
  event?: string | null;
  sender_role?: string | null;
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

  // Invariant: a company that runs exams never receives an application, so an
  // exam email continues an application rather than starting one, whatever
  // title it carries. The employer announced the assessment; the vendor named
  // the paper after the programme instead of the posting, and the two titles
  // share one word.
  { day: "2026-07-01", thread: "t36", sender: "careers@stark.example", subject: "Application received", company: "Stark Devices", role: "Applied Robotics Engineer Intern, Malibu", status: "APPLIED", significant: true, title: "Application Confirmation" },
  { day: "2026-07-02", thread: "t37", sender: "no-reply@stark.example", subject: "Next Steps: Technical Assessment", company: "Stark Devices", role: "Applied Robotics Engineer Intern, Malibu", status: "IN_PROGRESS", stage: "ASSESSMENT", significant: true, title: "Assessment Invitation" },
  { day: "2026-07-03", thread: "t38", sender: "mailer@hackerrankforwork.com", subject: "Stark Global ENG Intern Test Invitation", company: "Stark Devices", role: "Global ENG and Robotics Intern", status: "IN_PROGRESS", stage: "ASSESSMENT", significant: true, title: "Assessment Invitation" },
  // ... and the completion notice, which names no role at all, so every row at
  // that employer would accept it. Not settled is not the same as nothing
  // found, and the step has to run in both cases or this email is guessed at.
  { day: "2026-07-04", thread: "t39", sender: "mailer@hackerrankforwork.com", subject: "Thanks for taking the Stark Global ENG Intern Test", company: "Stark Devices", role: null, status: "IN_PROGRESS", stage: "ASSESSMENT", significant: false, title: "Assessment Completion Confirmation" },

  // The rule: two postings at one employer are
  // both waiting on an assessment here, so the vendor's email is about both of
  // them. It used to make a third row, on the grounds that a guess was worse
  // than an extra row. Belonging is a row of its own now, so there is a third
  // answer that is neither a guess nor an invention: it reaches both.
  { day: "2026-07-05", thread: "t40", sender: "careers@wayne.example", subject: "Complete your pre interview assessment", company: "Wayne Systems", role: "Software Engineering, Gotham", status: "IN_PROGRESS", stage: "ASSESSMENT", significant: true, title: "Assessment Invitation" },
  { day: "2026-07-05", thread: "t41", sender: "careers@wayne.example", subject: "Complete your pre interview assessment", company: "Wayne Systems", role: "Software Engineering, Bludhaven", status: "IN_PROGRESS", stage: "ASSESSMENT", significant: true, title: "Assessment Invitation" },
  { day: "2026-07-06", thread: "t42", sender: "mailer@codility.com", subject: "Wayne invites you to a test", company: "Wayne Systems", role: "Engineering Test", status: "IN_PROGRESS", stage: "ASSESSMENT", significant: true, title: "Assessment Invitation" },

  // Invariant: an exam vendor writing about an employer with no application at
  // all still creates one. Refusing would lose the email altogether, and a row
  // that says only "there was an exam" is more than nothing.
  { day: "2026-07-07", thread: "t43", sender: "mailer@codility.com", subject: "Oscorp invites you to a test", company: "Oscorp", role: "Chemistry Test", status: "IN_PROGRESS", stage: "ASSESSMENT", significant: true, title: "Assessment Invitation" },

  // Invariant: a platform sends the employer's own mail, so it can begin an
  // application. Several rows on the real board exist only because a platform
  // sent their confirmation, and labelling one of these an exam vendor would
  // delete them without a word.
  { day: "2026-07-08", thread: "t44", sender: "no-reply@greenhouse.io", subject: "Thank you for applying", company: "Tyrell", role: "Genetics Intern", status: "APPLIED", significant: true, title: "Application Confirmation" },

  // Invariant: what a row is waiting on is read from its emails, not from its
  // status column. That column still says APPLIED here, because it is written
  // when the row is made and not touched again until stage 5, which runs after
  // the whole matching pass. Read the column and this exam starts its own row.
  { day: "2026-07-09", thread: "t45", sender: "careers@abstergo.example", subject: "Application received", company: "Abstergo", role: "Animus Platform Intern", status: "APPLIED", significant: true, title: "Application Confirmation" },
  { day: "2026-07-10", thread: "t46", sender: "careers@abstergo.example", subject: "Next Steps: Technical Assessment", company: "Abstergo", role: "Animus Platform Intern", status: "IN_PROGRESS", stage: "ASSESSMENT", significant: true, title: "Assessment Invitation" },
  { day: "2026-07-11", thread: "t47", sender: "mailer@criteriacorp.com", subject: "Abstergo invites you to complete an assessment", company: "Abstergo", role: "Historical Analysis Battery", status: "IN_PROGRESS", stage: "ASSESSMENT", significant: true, title: "Assessment Invitation" },
  // ... and a nudge about that stage, worded like neither of the two papers.
  { day: "2026-07-12", thread: "t48", sender: "careers@abstergo.example", subject: "Reminder: Animus competency assessment completion", company: "Abstergo", role: "Animus Platform Intern", status: "IN_PROGRESS", stage: "ASSESSMENT", significant: false, title: "Assessment Completion Reminder" },

  // Invariant: a rule about a kind of word matches the kind, never a list of
  // examples. Two emails about one posting quote its title with the year
  // written differently, and one row is the right answer whichever year it is.
  // The first pair uses years the old hardcoded list happened to name, so it
  // is the guard on what already worked.
  { day: "2026-08-01", thread: "t49", sender: "careers@gringotts.example", subject: "Application received", company: "Gringotts", role: "Software Engineer Intern 2027", status: "APPLIED", significant: true, title: "Application Confirmation" },
  { day: "2026-08-02", thread: "t50", sender: "careers@gringotts.example", subject: "Next steps", company: "Gringotts", role: "Software Engineer Intern 2028", status: "IN_PROGRESS", stage: "INTERVIEW", significant: true, title: "Recruiter Screen" },
  // ... and the second uses years twenty years out, which is the whole point:
  // a list of examples expires on a date and nothing announces it.
  { day: "2026-08-03", thread: "t51", sender: "careers@zorg.example", subject: "Application received", company: "Zorg", role: "Data Engineer Intern 2046", status: "APPLIED", significant: true, title: "Application Confirmation" },
  { day: "2026-08-04", thread: "t52", sender: "careers@zorg.example", subject: "Next steps", company: "Zorg", role: "Data Engineer Intern 2047", status: "IN_PROGRESS", stage: "INTERVIEW", significant: true, title: "Recruiter Screen" },

  // Invariant: a stage is what the applicant has to go and do, not what the
  // employer called it. A test with right answers and a camera you answer
  // alone in front of are different steps, need different nerve, and used to
  // be filed as the same thing because there was nowhere else to put one.
  { day: "2026-09-01", thread: "t53", sender: "careers@bluesun.example", subject: "Application received", company: "Blue Sun", role: "Systems Intern", status: "APPLIED", event: "CONFIRMATION", significant: true, title: "Application Confirmation" },
  { day: "2026-09-02", thread: "t54", sender: "careers@bluesun.example", subject: "Coding assessment", company: "Blue Sun", role: "Systems Intern", status: "IN_PROGRESS", stage: "ASSESSMENT", event: "INVITATION", significant: true, title: "Coding Assessment" },
  { day: "2026-09-03", thread: "t55", sender: "careers@bluesun.example", subject: "Recorded competency interview", company: "Blue Sun", role: "Systems Intern", status: "IN_PROGRESS", stage: "RECORDED_INTERVIEW", event: "INVITATION", significant: true, title: "Recorded Competency Interview" },

  // ... and a take home is marked, so it is an assessment however long the
  // applicant is given for it. The stage is defined by being marked, never by
  // being timed.
  { day: "2026-09-04", thread: "t56", sender: "careers@encom.example", subject: "Take home project", company: "Encom", role: "Graphics Intern", status: "IN_PROGRESS", stage: "ASSESSMENT", event: "INVITATION", significant: true, title: "Take Home Project" },

  // A recruiter phone screen, a panel and a whole day on site are all one
  // person talking to another, whatever the day is called.
  { day: "2026-09-05", thread: "t57", sender: "talent@nakatomi.example", subject: "Recruiter phone screen", company: "Nakatomi", role: "Security Intern", status: "IN_PROGRESS", stage: "INTERVIEW", event: "INVITATION", significant: true, title: "Phone Screen" },
  { day: "2026-09-06", thread: "t58", sender: "talent@nakatomi.example", subject: "Panel interview", company: "Nakatomi", role: "Security Intern", status: "IN_PROGRESS", stage: "INTERVIEW", event: "INVITATION", significant: true, title: "Panel Interview" },
  { day: "2026-09-07", thread: "t59", sender: "talent@nakatomi.example", subject: "Superday, our final round", company: "Nakatomi", role: "Security Intern", status: "IN_PROGRESS", stage: "INTERVIEW", event: "INVITATION", significant: true, title: "Final Round" },

  // Invariant: a check after an offer is a step of the same application. It is
  // supplied and checked rather than judged, which is the fourth stage, and
  // this mailbox has never seen one.
  { day: "2026-09-08", thread: "t60", sender: "talent@nakatomi.example", subject: "Your offer", company: "Nakatomi", role: "Security Intern", status: "ACCEPTED", event: "DECISION", significant: true, title: "Offer" },
  { day: "2026-09-09", thread: "t61", sender: "talent@nakatomi.example", subject: "Background check consent", company: "Nakatomi", role: "Security Intern", status: "ACCEPTED", stage: "VERIFICATION", event: "REQUEST", significant: false, title: "Background Check" },
  { day: "2026-09-10", thread: "t62", sender: "talent@nakatomi.example", subject: "Onboarding forms", company: "Nakatomi", role: "Security Intern", status: "ACCEPTED", stage: "VERIFICATION", event: "REQUEST", significant: false, title: "Onboarding Paperwork" },

  // Invariant: an exam email continues an application rather than starting
  // one, and what the row is waiting on is any step the applicant was sent
  // away to do. This row is waiting on a recording rather than on a test,
  // which is a distinction the stage vocabulary gained late, and the
  // vendor's paper still belongs to it.
  { day: "2026-09-11", thread: "t63", sender: "careers@genco.example", subject: "Application received", company: "Genco", role: "Olive Oil Logistics Intern", status: "APPLIED", event: "CONFIRMATION", significant: true, title: "Application Confirmation" },
  { day: "2026-09-12", thread: "t64", sender: "careers@genco.example", subject: "Recorded interview", company: "Genco", role: "Olive Oil Logistics Intern", status: "IN_PROGRESS", stage: "RECORDED_INTERVIEW", event: "INVITATION", significant: true, title: "Recorded Interview" },
  { day: "2026-09-13", thread: "t65", sender: "mailer@hirevue.com", subject: "Genco invites you to record your answers", company: "Genco", role: "Logistics Video Set", status: "IN_PROGRESS", stage: "RECORDED_INTERVIEW", event: "INVITATION", significant: true, title: "Recorded Interview" },

  // Invariant: a reminder announces nothing. The nudge is worded differently
  // from the invitation on purpose, which is what makes it a reminder and what
  // stops the resend rule in stage 5 from catching it, so the model is asked
  // not to call it significant and the history stays honest without a rule
  // that reads wording.
  { day: "2026-09-14", thread: "t66", sender: "careers@vandelay.example", subject: "Complete your assessment", company: "Vandelay", role: "Import Analytics Intern", status: "IN_PROGRESS", stage: "ASSESSMENT", event: "INVITATION", significant: true, title: "Assessment Invitation" },
  { day: "2026-09-15", thread: "t67", sender: "careers@vandelay.example", subject: "A friendly nudge about your next step", company: "Vandelay", role: "Import Analytics Intern", status: "IN_PROGRESS", stage: "ASSESSMENT", event: "REMINDER", significant: false, title: "Assessment Reminder" },
  // ... and a nudge that also carries something new in itself still counts.
  { day: "2026-09-16", thread: "t68", sender: "careers@vandelay.example", subject: "Your assessment deadline has moved to Friday", company: "Vandelay", role: "Import Analytics Intern", status: "IN_PROGRESS", stage: "ASSESSMENT", event: "UPDATE", significant: true, title: "Assessment Deadline Update" },

  // Invariant: a rule may be helped by a list of names and may never fail for
  // want of one. This exam vendor is in no list anywhere in the code, and the
  // paper it sends still lands on the one application waiting for it, because
  // the email says what its sender is and the model was asked.
  { day: "2026-10-01", thread: "t69", sender: "careers@spacelyspr.example", subject: "Application received", company: "Spacely Sprockets", role: "Cogswell Rivalry Intern", status: "APPLIED", event: "CONFIRMATION", sender_role: "EMPLOYER", significant: true, title: "Application Confirmation" },
  { day: "2026-10-02", thread: "t70", sender: "careers@spacelyspr.example", subject: "Next steps: your assessment", company: "Spacely Sprockets", role: "Cogswell Rivalry Intern", status: "IN_PROGRESS", stage: "ASSESSMENT", event: "INVITATION", sender_role: "EMPLOYER", significant: true, title: "Assessment Invitation" },
  { day: "2026-10-03", thread: "t71", sender: "tests@quizzitron.example", subject: "Spacely invites you to a sprocket aptitude test", company: "Spacely Sprockets", role: "Sprocket Aptitude Battery", status: "IN_PROGRESS", stage: "ASSESSMENT", event: "INVITATION", sender_role: "ASSESSMENT_VENDOR", significant: true, title: "Assessment Invitation" },

  // ... and a platform nobody has heard of still begins an application, which
  // is the mistake in the other direction: read this sender as an exam vendor
  // and the row it starts is never created at all.
  { day: "2026-10-04", thread: "t72", sender: "no-reply@hirestack.example", subject: "Thank you for applying", company: "Duff Brewing", role: "Fermentation Intern", status: "APPLIED", event: "CONFIRMATION", sender_role: "PLATFORM", significant: true, title: "Application Confirmation" },

  // ... and an employer writing for itself is neither.
  { day: "2026-10-05", thread: "t73", sender: "careers@vandelay.example", subject: "Thanks for applying", company: "Vandelay", role: "Latex Sales Intern", status: "APPLIED", event: "CONFIRMATION", sender_role: "EMPLOYER", significant: true, title: "Application Confirmation" },

  // Invariant: a step that is supplied and checked rather than judged is
  // administration. It holds a line of its own in the drawer, because the
  // applicant does have to go and do it, and it moves nothing: the row stays
  // where it was and the history records nothing.
  { day: "2026-10-06", thread: "t74", sender: "careers@bluth.example", subject: "Application received", company: "Bluth Homes", role: "Banana Stand Intern", status: "APPLIED", event: "CONFIRMATION", significant: true, title: "Application Confirmation" },
  { day: "2026-10-07", thread: "t75", sender: "careers@bluth.example", subject: "Confirm your identity to continue", company: "Bluth Homes", role: "Banana Stand Intern", status: "APPLIED", stage: "VERIFICATION", event: "REQUEST", significant: false, title: "Identity Check" },

  // Invariant: an alias may be written from a match somebody could point at.
  // These two share a thread, which is something the employer's own system
  // did, and they spell the employer two ways. That pair is exactly what the
  // alias table is for, and it survives the rule that stopped the guesses.
  { day: "2026-11-01", thread: "t76", sender: "careers@weyland.example", subject: "Application received", company: "Weyland Yutani", role: "Terraforming Intern", status: "APPLIED", event: "CONFIRMATION", significant: true, title: "Application Confirmation" },
  { day: "2026-11-02", thread: "t76", sender: "careers@weyland.example", subject: "Re: Application received", company: "Weyland", role: "Terraforming Intern", status: "IN_PROGRESS", stage: "INTERVIEW", event: "INVITATION", significant: true, title: "Recruiter Screen" },

  // Invariant: an application that ended and then went quiet is finished. A
  // later email under the same title is a new application, because these
  // postings come back every year and most employers state no season and no
  // year at all.
  //
  // Applied, rejected, and then the same posting comes round fourteen months
  // later. Two applications, one of which ended.
  { day: "2026-01-05", thread: "t77", sender: "careers@omnicorp.example", subject: "Application received", company: "Omni Consumer Products", role: "Robotics Intern", status: "APPLIED", event: "CONFIRMATION", significant: true, title: "Application Confirmation" },
  { day: "2026-01-20", thread: "t78", sender: "careers@omnicorp.example", subject: "Update on your application", company: "Omni Consumer Products", role: "Robotics Intern", status: "REJECTED", event: "DECISION", significant: true, title: "Application Update" },
  { day: "2027-03-20", thread: "t79", sender: "careers@omnicorp.example", subject: "Application received", company: "Omni Consumer Products", role: "Robotics Intern", status: "APPLIED", event: "CONFIRMATION", significant: true, title: "Application Confirmation" },

  // ... and two weeks is not a new hiring cycle, so this one joins the row it
  // belongs to and the row stays closed.
  { day: "2026-01-05", thread: "t80", sender: "careers@sirius.example", subject: "Application received", company: "Sirius Cybernetics", role: "Marketing Intern", status: "APPLIED", event: "CONFIRMATION", significant: true, title: "Application Confirmation" },
  { day: "2026-01-20", thread: "t81", sender: "careers@sirius.example", subject: "Update on your application", company: "Sirius Cybernetics", role: "Marketing Intern", status: "REJECTED", event: "DECISION", significant: true, title: "Application Update" },
  { day: "2026-02-03", thread: "t82", sender: "careers@sirius.example", subject: "One more note on your application", company: "Sirius Cybernetics", role: "Marketing Intern", status: "REJECTED", event: "UPDATE", significant: false, title: "Application Update" },

  // ... a reply on the original thread belongs to the old application however
  // long the gap, because the thread is the employer's own system saying so.
  { day: "2026-01-05", thread: "t83", sender: "careers@yoyodyne.example", subject: "Application received", company: "Yoyodyne", role: "Propulsion Intern", status: "APPLIED", event: "CONFIRMATION", significant: true, title: "Application Confirmation" },
  { day: "2026-01-20", thread: "t83", sender: "careers@yoyodyne.example", subject: "Update on your application", company: "Yoyodyne", role: "Propulsion Intern", status: "REJECTED", event: "DECISION", significant: true, title: "Application Update" },
  { day: "2027-05-20", thread: "t83", sender: "careers@yoyodyne.example", subject: "Re: Update on your application", company: "Yoyodyne", role: "Propulsion Intern", status: "REJECTED", event: "UPDATE", significant: false, title: "Application Update" },

  // ... and so does one quoting the old posting number, which is the employer
  // saying it directly.
  { day: "2026-01-05", thread: "t84", sender: "careers@buynlarge.example", subject: "Application received (Job number: 550021)", company: "Buy n Large", role: "Waste Systems Intern", status: "APPLIED", event: "CONFIRMATION", significant: true, title: "Application Confirmation" },
  { day: "2026-01-20", thread: "t85", sender: "careers@buynlarge.example", subject: "Update on your application", company: "Buy n Large", role: "Waste Systems Intern", status: "REJECTED", event: "DECISION", significant: true, title: "Application Update" },
  { day: "2027-05-20", thread: "t86", sender: "careers@buynlarge.example", subject: "A note about job number 550021", company: "Buy n Large", role: "Waste Systems Intern", status: "REJECTED", event: "UPDATE", significant: false, title: "Application Update" },

  // Invariant: an email belongs to every application it is about, and to no
  // others. Two live postings at one employer, both waiting on an assessment.
  { day: "2026-06-01", thread: "t87", sender: "careers@cheyenne.example", subject: "Application received", company: "Cheyenne Mountain", role: "Systems Intern Alpha", status: "APPLIED", event: "CONFIRMATION", significant: true, title: "Application Confirmation" },
  { day: "2026-06-01", thread: "t88", sender: "careers@cheyenne.example", subject: "Application received", company: "Cheyenne Mountain", role: "Systems Intern Beta", status: "APPLIED", event: "CONFIRMATION", significant: true, title: "Application Confirmation" },
  { day: "2026-06-02", thread: "t89", sender: "careers@cheyenne.example", subject: "Complete your assessment", company: "Cheyenne Mountain", role: "Systems Intern Alpha", status: "IN_PROGRESS", stage: "ASSESSMENT", event: "INVITATION", significant: true, title: "Assessment Invitation" },
  { day: "2026-06-02", thread: "t90", sender: "careers@cheyenne.example", subject: "Complete your assessment", company: "Cheyenne Mountain", role: "Systems Intern Beta", status: "IN_PROGRESS", stage: "ASSESSMENT", event: "INVITATION", significant: true, title: "Assessment Invitation" },
  // ... and one email about that step naming no posting at all. It is about
  // both, and it carries something new, so both rows record it.
  { day: "2026-06-05", thread: "t91", sender: "careers@cheyenne.example", subject: "Your assessment deadline has moved to Friday", company: "Cheyenne Mountain", role: null, status: "IN_PROGRESS", stage: "ASSESSMENT", event: "UPDATE", significant: true, title: "Assessment Deadline Update" },
  // ... but a decision naming no posting never fans out, because employers
  // withhold a rejection precisely when the candidate is live elsewhere. One
  // email may not close two real applications.
  { day: "2026-06-20", thread: "t92", sender: "careers@cheyenne.example", subject: "Update on your application", company: "Cheyenne Mountain", role: null, status: "REJECTED", event: "DECISION", significant: true, title: "Application Update" },

  // Invariant: fan out reaches rows waiting on this very step and no others.
  // One of these is waiting on an assessment and the other is merely applied.
  { day: "2026-06-01", thread: "t93", sender: "careers@nostromo.example", subject: "Application received", company: "Nostromo Freight", role: "Cargo Intern North", status: "APPLIED", event: "CONFIRMATION", significant: true, title: "Application Confirmation" },
  { day: "2026-06-01", thread: "t94", sender: "careers@nostromo.example", subject: "Application received", company: "Nostromo Freight", role: "Cargo Intern South", status: "APPLIED", event: "CONFIRMATION", significant: true, title: "Application Confirmation" },
  { day: "2026-06-02", thread: "t95", sender: "careers@nostromo.example", subject: "Complete your assessment", company: "Nostromo Freight", role: "Cargo Intern North", status: "IN_PROGRESS", stage: "ASSESSMENT", event: "INVITATION", significant: true, title: "Assessment Invitation" },
  { day: "2026-06-04", thread: "t96", sender: "careers@nostromo.example", subject: "A nudge about your assessment", company: "Nostromo Freight", role: null, status: "IN_PROGRESS", stage: "ASSESSMENT", event: "REMINDER", significant: false, title: "Assessment Reminder" },

  // Invariant: a quoted posting number is a real answer and decides alone, so
  // fan out never runs. Both of these are waiting on an assessment and the
  // email names one of them by number.
  { day: "2026-06-01", thread: "t97", sender: "careers@aperturescience.example", subject: "Application received (Job number: 660001)", company: "Aperture Science", role: "Test Chamber Intern", status: "APPLIED", event: "CONFIRMATION", significant: true, title: "Application Confirmation" },
  { day: "2026-06-01", thread: "t98", sender: "careers@aperturescience.example", subject: "Application received (Job number: 660002)", company: "Aperture Science", role: "Test Chamber Intern", status: "APPLIED", event: "CONFIRMATION", significant: true, title: "Application Confirmation" },
  { day: "2026-06-02", thread: "t99", sender: "careers@aperturescience.example", subject: "Assessment for 660001", company: "Aperture Science", role: "Test Chamber Intern", status: "IN_PROGRESS", stage: "ASSESSMENT", event: "INVITATION", significant: true, title: "Assessment Invitation" },
  { day: "2026-06-03", thread: "ta1", sender: "careers@aperturescience.example", subject: "Assessment for 660002", company: "Aperture Science", role: "Test Chamber Intern", status: "IN_PROGRESS", stage: "ASSESSMENT", event: "INVITATION", significant: true, title: "Assessment Invitation" },
  { day: "2026-06-06", thread: "ta2", sender: "careers@aperturescience.example", subject: "Reminder about job number 660002", company: "Aperture Science", role: null, status: "IN_PROGRESS", stage: "ASSESSMENT", event: "REMINDER", significant: false, title: "Assessment Reminder" },

  // Invariant: a first confirmation has nothing to gate on, so fan out
  // declines. Two rows at this employer and nothing is waiting on any step, so
  // the honest answer is that the code does not know which row this belongs to.
  { day: "2026-06-01", thread: "ta3", sender: "careers@blackmesa.example", subject: "Application received", company: "Black Mesa", role: "Anomalous Materials Intern", status: "APPLIED", event: "CONFIRMATION", significant: true, title: "Application Confirmation" },
  { day: "2026-06-01", thread: "ta4", sender: "careers@blackmesa.example", subject: "Application received", company: "Black Mesa", role: "Lambda Complex Intern", status: "APPLIED", event: "CONFIRMATION", significant: true, title: "Application Confirmation" },
  { day: "2026-06-03", thread: "ta5", sender: "careers@blackmesa.example", subject: "Thanks for applying", company: "Black Mesa", role: null, status: "APPLIED", event: "CONFIRMATION", significant: true, title: "Application Confirmation" },
];

async function seed() {
  const account = await prisma.gmailAccount.create({
    data: { emailAddress: "check@example.com", refreshToken: "none", displayName: "Check" },
  });

  // Serial, not Promise.all: concurrent inserts take their row ids in whatever
  // order they land, and two fixtures sharing a day are then separated by a
  // random number. The snapshot below is only a baseline if the ids are fixed.
  for (const [index, fixture] of FIXTURES.entries()) {
    await prisma.emailMessage.create({
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
          email_event: fixture.event ?? null,
          sender_role: fixture.sender_role ?? "EMPLOYER",
          is_significant: fixture.significant,
          email_title: fixture.title,
          confidence_score: 0.9,
          summary: fixture.subject,
        }),
      },
    });
  }
}

async function snapshot() {
  const rows = await prisma.application.findMany({
    orderBy: [{ companyName: "asc" }, { id: "asc" }],
    include: {
      memberships: {
        select: {
          parentMessageId: true,
          parentRelation: true,
          message: {
            select: { id: true, gmailMessageId: true, isSignificant: true, subject: true, receivedAt: true },
          },
        },
      },
      statusHistory: true,
    },
  });

  const applications = rows.map((application) => ({
    ...application,
    messages: application.memberships
      .map((membership) => ({
        ...membership.message,
        parentMessageId: membership.parentMessageId,
        parentRelation: membership.parentRelation,
      }))
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.id - b.id),
  }));

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
    tree: application.messages.map((message) => ({
      id: message.gmailMessageId,
      parent: application.messages.find((other) => other.id === message.parentMessageId)?.gmailMessageId ?? null,
      relation: message.parentRelation,
    })),
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

const unattached = await prisma.emailMessage.count({ where: { memberships: { none: {} } } });

console.log(JSON.stringify(first, null, 2));

expect("fifty applications", first.length === 50);
expect(
  "an administrative step holds its own line and moves nothing",
  (() => {
    const row = first.find((item) => item.company === "Bluth Homes")!;
    return (
      row.status === "APPLIED" &&
      row.milestones === 1 &&
      row.tree.filter((node) => node.parent === null).length === 2
    );
  })(),
);
expect(
  "an exam vendor no list has ever heard of still continues an application",
  first.filter((row) => row.company === "Spacely Sprockets").length === 1 &&
    first.find((row) => row.company === "Spacely Sprockets")?.emails.length === 3,
);
expect(
  "a platform no list has ever heard of still begins one",
  first.filter((row) => row.company === "Duff Brewing").length === 1,
);
expect(
  "an employer writing for itself is neither of those",
  first.filter((row) => row.company === "Vandelay").length === 2,
);
expect(
  "a reminder writes no milestone, and the invitation and the moved deadline both do",
  (() => {
    const row = first.find((item) => item.company === "Vandelay")!;
    return row.emails.length === 3 && row.milestones === 2;
  })(),
);
expect(
  "a recorded interview is its own stage, not a test",
  first.find((row) => row.company === "Blue Sun")?.stage === "RECORDED_INTERVIEW",
);
expect(
  "a coding test and a recording at one employer are one row and two steps",
  (() => {
    const row = first.find((item) => item.company === "Blue Sun")!;
    return row.emails.length === 3 && row.tree.filter((node) => node.parent === null).length === 3;
  })(),
);
expect(
  "a take home is an assessment, because it is marked rather than timed",
  first.find((row) => row.company === "Encom")?.stage === "ASSESSMENT",
);
expect(
  "a phone screen, a panel and a whole day on site are all one interview stage",
  (() => {
    const row = first.find((item) => item.company === "Nakatomi")!;
    // Three invitations to one stage, so one line with the other two under it,
    // then the offer and the two checks that follow it.
    return row.tree.filter((node) => node.parent === null).length === 3 && row.emails.length === 6;
  })(),
);
expect(
  "a check after an offer belongs to the application that made it",
  first.filter((row) => row.company === "Nakatomi").length === 1,
);
expect(
  "an exam vendor's paper lands on the row waiting on a recording, not on a test",
  first.filter((row) => row.company === "Genco").length === 1 &&
    first.find((row) => row.company === "Genco")?.emails.length === 3,
);
expect(
  "a year the old list named is still noise in a title",
  first.filter((row) => row.company === "Gringotts").length === 1,
);
expect(
  "a year twenty years from now is noise too",
  first.filter((row) => row.company === "Zorg").length === 1,
);
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
expect(
  "an exam is a step inside an application, not an application",
  first.filter((row) => row.company === "Stark Devices").length === 1,
);
expect(
  "an exam email whose title agrees with nothing still lands on the one row waiting for it",
  first.find((row) => row.company === "Stark Devices")?.emails.length === 4,
);
expect(
  "one exam covering two postings reaches both of them rather than inventing a third row",
  first.filter((row) => row.company === "Wayne Systems").length === 2 &&
    first
      .filter((row) => row.company === "Wayne Systems")
      .every((row) => row.emails.length === 2),
);
expect(
  "an exam vendor writing about an employer with no application still creates one",
  first.filter((row) => row.company === "Oscorp").length === 1,
);
expect(
  "a platform sending a first confirmation still creates an application",
  first.filter((row) => row.company === "Tyrell").length === 1,
);
expect(
  "what a row is waiting on is read from its emails, not from its status column",
  first.filter((row) => row.company === "Abstergo").length === 1,
);

// Invariant: being a repeat is one case of being shown under an earlier email,
// and is stored as one. The risk in a rename is a change of behaviour smuggled
// inside it, so the two columns are checked to say exactly one thing each.
const tree = first.flatMap((row) => row.tree);
expect(
  "a relation is present exactly when a parent is",
  tree.every((node) => (node.parent === null) === (node.relation === null)),
);
expect(
  "a resend is still labelled REPEAT, which is what it always meant",
  tree.filter((node) => node.relation === "REPEAT").length > 0,
);
// Invariant: a drawer shows one line for each state the application reached,
// and every other email under the line for its own state. This row reached
// three: applied, interviewing, rejected. The fourth email is a scheduling
// reply that states no new state, so it is shown under the line for the state
// it does state rather than nowhere at all.
expect(
  "one line for each state the application reached, and no more",
  (() => {
    const row = first.find((item) => item.company === "Massive Dynamic")!;
    return row.tree.filter((node) => node.parent === null).length === 3 && row.tree.length === 4;
  })(),
);
// Invariant: the exam sits under the announcement of the stage it belongs to,
// because they are the same stage and the announcement came first. Neither
// title is compared with the other, which is the whole point: they do not
// agree, and no comparison of them could put this right.
expect(
  "an exam is shown under the announcement of the stage it belongs to",
  (() => {
    const row = first.find((item) => item.company === "Stark Devices")!;
    const invitation = row.tree[1];
    return (
      row.tree.filter((node) => node.parent === null).length === 2 &&
      row.tree[2].parent === invitation.id &&
      row.tree[3].parent === invitation.id
    );
  })(),
);
// Invariant: a nudge about a stage is shown beside the papers rather than
// under one of them, because a tree one level deep needs no ruling between two
// invitations a reader can see side by side anyway.
expect(
  "a reminder is labelled a reminder and sits alongside what it reminds about",
  (() => {
    const row = first.find((item) => item.company === "Abstergo")!;
    const announcement = row.tree[1];
    const reminder = row.tree[3];
    return (
      row.tree.length === 4 &&
      reminder.relation === "REMINDER" &&
      // Beside the two papers rather than under either of them. Which paper it
      // means is a question the drawer never has to answer.
      reminder.parent === announcement.id &&
      row.tree[2].parent === announcement.id
    );
  })(),
);
expect(
  "the two resends of one notice are shown under it, and it is not shown under anything",
  (() => {
    const row = first.find((item) => item.company === "Soylent Foods")!;
    const shown = row.tree.filter((node) => node.parent !== null);
    return (
      row.tree.length === 4 &&
      shown.length === 2 &&
      shown.every((node) => node.parent === row.tree[0].id && node.relation === "REPEAT")
    );
  })(),
);
expect(
  "no email is its own parent, and no parent has a parent",
  tree.every((node) => node.id !== node.parent) &&
    tree.every((node) => !node.parent || tree.find((other) => other.id === node.parent)?.parent === null),
);

// ------------------------------------------------------------------ titles
//
// The drawer's own rule, checked directly rather than through the database,
// because it is pure and because what it must never do is read a word out of
// the model's freeform title.

const { drawerTitle, TITLE_KEYWORD_RULES } = await import("../src/lib/drawer");

function titleOf(parts: {
  status?: string;
  stage?: string | null;
  event?: string | null;
  outcome?: string | null;
  title?: string;
  relation?: string | null;
}): string {
  return drawerTitle({
    id: 1,
    gmailMessageId: "title-check",
    emailTitle: parts.title ?? "Whatever The Model Called It",
    receivedAt: new Date("2026-01-01T00:00:00Z"),
    senderDomain: null,
    isSignificant: true,
    isApplicationRelated: true,
    llmClassificationRaw: JSON.stringify({
      status: parts.status ?? "IN_PROGRESS",
      stage_detail: parts.stage ?? null,
      email_event: parts.event ?? null,
      outcome: parts.outcome ?? null,
      is_application_related: true,
      is_significant: true,
      email_title: parts.title ?? "Whatever The Model Called It",
    }),
    parentMessageId: parts.relation ? 2 : null,
    parentRelation: parts.relation ?? null,
  });
}

expect("no branch of the display reads a word out of the model's title", TITLE_KEYWORD_RULES.length === 0);

// An ending is a fact about the application, exactly as a
// stage is, and gets a field of the same shape. Four of these are stored
// ACCEPTED and three are stored REJECTED, so the status alone cannot tell any
// of them apart.
expect(
  "a rescinded offer does not read as an offer",
  titleOf({ status: "ACCEPTED", event: "DECISION", outcome: "OFFER_RESCINDED" }) ===
    "Offer Withdrawn by the Employer",
);
expect(
  "an offer taken and an offer turned down read differently, though both are stored Accepted",
  titleOf({ status: "ACCEPTED", event: "DECISION", outcome: "OFFER_ACCEPTED" }) === "Offer Accepted" &&
    titleOf({ status: "ACCEPTED", event: "DECISION", outcome: "OFFER_DECLINED" }) === "Offer Declined",
);
expect(
  "a withdrawal and a rejection both close the row and read differently",
  titleOf({ status: "REJECTED", event: "DECISION", outcome: "WITHDRAWN_BY_APPLICANT" }) ===
    "Application Withdrawn" &&
    titleOf({ status: "REJECTED", event: "DECISION", outcome: "REJECTED_BY_EMPLOYER" }) ===
      "Application Rejected",
);
expect(
  "a posting that went away does not claim anybody was turned down",
  titleOf({ status: "REJECTED", event: "DECISION", outcome: "POSTING_CANCELLED" }) === "Posting Cancelled",
);
expect(
  "with no ending stated, a closed row still says only what every ending shares",
  titleOf({ status: "REJECTED", event: "DECISION" }) === "Application Closed",
);
expect(
  "a cancelled interview says the step stopped, not that the application ended",
  titleOf({ status: "IN_PROGRESS", stage: "INTERVIEW", event: "CANCELLATION" }) === "Interview Cancelled",
);

// Silence is not something an email says, so staleness is
// worked out from the set and never asked of the model.
const { isStale } = await import("../src/lib/pipeline/recompute");
const now = new Date("2026-06-01T00:00:00Z");
const daysBefore = (days: number) => new Date(now.getTime() - days * 86_400_000);

expect(
  "a row silent for months reads as quiet without any email having said so",
  isStale({ status: "APPLIED", latestEmailAt: daysBefore(120) }, now),
);
expect(
  "and it stops reading as quiet the moment one arrives",
  !isStale({ status: "APPLIED", latestEmailAt: daysBefore(1) }, now),
);
expect(
  "an application that ended is finished rather than ignored, so it is never quiet",
  !isStale({ status: "REJECTED", latestEmailAt: daysBefore(400) }, now) &&
    !isStale({ status: "ACCEPTED", latestEmailAt: daysBefore(400) }, now),
);
expect(
  "a recorded interview reads as one",
  titleOf({ stage: "RECORDED_INTERVIEW", event: "INVITATION" }) === "Recorded Interview Invitation",
);
expect(
  "a test at the same stage still reads as a test",
  titleOf({ stage: "ASSESSMENT", event: "INVITATION" }) === "Technical Assessment Invitation",
);
expect(
  "a check reads as a check",
  titleOf({ status: "APPLIED", stage: "VERIFICATION", event: "REQUEST" }) === "Verification Request",
);
// An answer this code has never seen degrades to the fallback and still draws
// a line. It never disappears and never stops the drawer saying something.
expect(
  "an event value nothing recognises falls back rather than vanishing",
  titleOf({ stage: "ASSESSMENT", event: "ESCALATION" }) === "Technical Assessment Update",
);
// Rung 3 of the ladder. Both enums empty means the answer was given before
// either field existed, and the model's own words beat a standard phrase that
// would be confidently wrong.
expect(
  "with no stage and no event the model's own title is shown",
  titleOf({ status: "IN_PROGRESS", title: "Something Nobody Has A Word For" }) ===
    "Something Nobody Has A Word For",
);
// The fixture that proves P1 is gone, and the one that would have failed on
// every day of this project so far.
expect(
  "a composed title is the same whatever language the model wrote its own in",
  (() => {
    const english = titleOf({ stage: "ASSESSMENT", event: "REMINDER", title: "Assessment Reminder" });
    const french = titleOf({ stage: "ASSESSMENT", event: "REMINDER", title: "Rappel: évaluation technique" });
    const empty = titleOf({ stage: "ASSESSMENT", event: "REMINDER", title: "" });
    return english === french && french === empty && english === "Technical Assessment Reminder";
  })(),
);
// A resend says nothing new, and says which kind of nothing.
expect(
  "a resent invitation reads as a reminder",
  titleOf({ stage: "ASSESSMENT", event: "INVITATION", relation: "REPEAT" }) ===
    "Technical Assessment Reminder",
);
expect(
  "a resent receipt reads as a duplicate, because there is nothing to be reminded of",
  titleOf({ status: "APPLIED", event: "CONFIRMATION", relation: "REPEAT" }) ===
    "Duplicate Application Confirmation",
);
// An application the person ended is stored REJECTED because it really did
// end. Only a rejection is a rejection.
expect(
  "an application that ended does not claim the applicant was turned down",
  titleOf({ status: "REJECTED", event: "CONFIRMATION" }) === "Application Closed" &&
    titleOf({ status: "REJECTED", event: "DECISION" }) === "Application Closed",
);
expect(
  "an offer reads as an offer, and news about one reads as news",
  titleOf({ status: "ACCEPTED", event: "DECISION" }) === "Offer" &&
    titleOf({ status: "ACCEPTED", event: "UPDATE" }) === "Offer Update",
);

// Time is evidence.
expect(
  "the same posting coming round a year later is a new application",
  first.filter((row) => row.company === "Omni Consumer Products").length === 2,
);
expect(
  "and the one that ended still says it ended",
  first
    .filter((row) => row.company === "Omni Consumer Products")
    .map((row) => row.status)
    .sort()
    .join(",") === "APPLIED,REJECTED",
);
expect(
  "two weeks is not a new hiring cycle, so a later note joins the row that ended",
  first.filter((row) => row.company === "Sirius Cybernetics").length === 1 &&
    first.find((row) => row.company === "Sirius Cybernetics")?.emails.length === 3,
);
expect(
  "a reply on the original thread joins the old application however long the gap",
  first.filter((row) => row.company === "Yoyodyne").length === 1 &&
    first.find((row) => row.company === "Yoyodyne")?.emails.length === 3,
);
expect(
  "an email quoting the old posting number joins the old application too",
  first.filter((row) => row.company === "Buy n Large").length === 1 &&
    first.find((row) => row.company === "Buy n Large")?.emails.length === 3,
);

// An email belongs to every application it is about.
//
// Written without naming any message id, because the ids are positions in the
// fixture list, and every insertion above would move them with nothing to say so.
const rowsFor = (company: string) => first.filter((row) => row.company === company);
/** Emails held by more than one of these rows: what fan out actually produced. */
const sharedAmong = (company: string) => {
  const counts = new Map<string, number>();
  for (const row of rowsFor(company)) {
    for (const id of row.emails) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
};

expect(
  "one email about a step two rows are waiting on reaches both of them",
  rowsFor("Cheyenne Mountain").length === 2 && sharedAmong("Cheyenne Mountain").length === 1,
);
expect(
  "and both rows record it, because both of them really did move",
  rowsFor("Cheyenne Mountain").every((row) => row.milestones >= 3),
);
expect(
  "a decision naming no posting closes exactly one row, never two",
  rowsFor("Cheyenne Mountain").filter((row) => row.status === "REJECTED").length === 1,
);
expect(
  "a reminder reaches only the row that is waiting, not the one merely applied",
  (() => {
    const rows = rowsFor("Nostromo Freight");
    const waiting = rows.find((row) => row.stage === "ASSESSMENT");
    const idle = rows.find((row) => row.stage === null);
    return (
      rows.length === 2 &&
      !sharedAmong("Nostromo Freight").length &&
      waiting?.emails.length === 3 &&
      idle?.emails.length === 1
    );
  })(),
);
expect(
  "a quoted posting number decides alone and fan out never runs",
  rowsFor("Aperture Science").length === 2 &&
    !sharedAmong("Aperture Science").length &&
    rowsFor("Aperture Science")
      .map((row) => row.emails.length)
      .sort()
      .join(",") === "2,3",
);
expect(
  "a first confirmation naming no posting fans out to nothing, because nothing is waiting",
  rowsFor("Black Mesa").length === 2 && !sharedAmong("Black Mesa").length,
);

// ------------------------------------------------------------- membership
//
// Belonging to an application is a fact about a pair, so it
// is stored on the pair. Nothing in the matching rules creates a second
// membership yet, so this writes one by hand and checks the shape can hold it:
// one email, two applications, and a different line above it in each drawer.

const { applicationsOf, messagesOf } = await import("../src/lib/pipeline/membership");

{
  const [left, right] = await prisma.application.findMany({
    where: { companyName: { in: ["Wayne Systems"] } },
    orderBy: { id: "asc" },
    take: 2,
  });
  const shared = (await messagesOf(prisma, left.id))[0];
  const anchor = (await messagesOf(prisma, right.id))[0];

  await prisma.applicationMembership.create({
    data: {
      applicationId: right.id,
      messageId: shared.id,
      reason: "FANOUT",
      parentMessageId: anchor.id,
      parentRelation: "UPDATE",
    },
  });

  const inLeft = await messagesOf(prisma, left.id);
  const inRight = await messagesOf(prisma, right.id);
  const homes = await applicationsOf(prisma, shared.id);

  expect(
    "one email can belong to two applications",
    homes.length === 2 && homes.includes(left.id) && homes.includes(right.id),
  );
  expect(
    "and it sits under a different line in each drawer",
    inLeft.find((message) => message.id === shared.id)?.parentMessageId === null &&
      inRight.find((message) => message.id === shared.id)?.parentMessageId === anchor.id,
  );

  // Put it back, so nothing below sees a board the matching rules never made.
  await prisma.applicationMembership.delete({
    where: { applicationId_messageId: { applicationId: right.id, messageId: shared.id } },
  });
}

const { repairGrouping } = await import("../src/lib/pipeline/repair");
const { emptyCounters } = await import("../src/lib/pipeline/counters");

type Seed = {
  company: string;
  role: string | null;
  status?: string;
  stage?: string | null;
  /** The term the emails state, in their words. */
  term?: string | null;
  emails: { day: string; subject: string; reason?: string }[];
};

let seedCount = 0;

/** One application with its emails, written straight into the board. */
async function seedApplication(account: number, seed: Seed): Promise<number> {
  seedCount += 1;
  const application = await prisma.application.create({
    data: {
      companyName: seed.company,
      companyNormalized: seed.company.toLowerCase(),
      roleTitle: seed.role,
      term: seed.term ?? null,
      dedupeKey: `seed:${seedCount}`,
      status: seed.status ?? "APPLIED",
    },
  });

  for (const [index, email] of seed.emails.entries()) {
    const message = await prisma.emailMessage.create({
      data: {
        gmailAccountId: account,
        gmailMessageId: `seed-${seedCount}-${index}`,
        threadId: `seed-thread-${seedCount}-${index}`,
        senderEmail: "careers@seed.example",
        senderDomain: "seed.example",
        subject: email.subject,
        bodyText: email.subject,
        receivedAt: new Date(`${email.day}T12:00:00Z`),
        classificationStatus: "OK",
        classifierVersion: CLASSIFIER_VERSION,
        isApplicationRelated: true,
        isSignificant: true,
        emailTitle: "Seed",
        llmClassificationRaw: JSON.stringify({
          is_application_related: true,
          company_name: seed.company,
          role_title: seed.role,
          term: seed.term ?? null,
          status: seed.status ?? "APPLIED",
          stage_detail: seed.stage ?? null,
          is_significant: true,
          email_title: "Seed",
          confidence_score: 0.9,
        }),
      },
    });
    await prisma.applicationMembership.create({
      data: {
        applicationId: application.id,
        messageId: message.id,
        reason: email.reason ?? "TITLE",
      },
    });
  }

  return application.id;
}

async function clearSeeds(): Promise<void> {
  await prisma.applicationMembership.deleteMany({
    where: { message: { gmailMessageId: { startsWith: "seed-" } } },
  });
  await prisma.emailMessage.deleteMany({ where: { gmailMessageId: { startsWith: "seed-" } } });
  await prisma.application.deleteMany({ where: { dedupeKey: { startsWith: "seed:" } } });
  await prisma.application.deleteMany({ where: { dedupeKey: { contains: "#split:" } } });
}

const seedAccount = (await prisma.gmailAccount.findFirstOrThrow()).id;

// ------------------------------------------------------------ adjudicator
//
// A tie is a question, not an answer. The model reads the
// email; when the code has run out of evidence, the model is asked, once, with
// the candidates in front of it.
//
// Driven with a stub rather than a provider, so these cost nothing and are
// deterministic. What is being checked is the rule around the call: when it
// fires, what it is allowed to do with each answer, and that every failure
// leaves the board exactly as it would have been.

{
  const { attachClassified: match } = await import("../src/lib/pipeline/match");
  const { recomputeAll: recompute } = await import("../src/lib/pipeline/recompute");

/**
   * Two live rows at one employer. With a stage they are both waiting on the
   * very step the loose email is about, which is trigger 2; without one the
   * loose email reaches the score with two exactly level candidates, which is
   * trigger 1.
   */
  async function twoWaiting(company: string, stage: string | null = null): Promise<number[]> {
    const ids: number[] = [];
    for (const suffix of ["North", "South"]) {
      ids.push(
        await seedApplication(seedAccount, {
          company,
          role: `${company} Intern ${suffix}`,
          status: "IN_PROGRESS",
          stage,
          emails: [{ day: "2026-01-01", subject: `Complete your assessment ${suffix}` }],
        }),
      );
    }
    return ids;
  }

  /** One unclaimed email about that step, naming no posting. */
  async function loose(company: string): Promise<void> {
    seedCount += 1;
    await prisma.emailMessage.create({
      data: {
        gmailAccountId: seedAccount,
        gmailMessageId: `seed-${seedCount}-loose`,
        threadId: `seed-loose-${seedCount}`,
        senderEmail: "tests@vendor.example",
        senderDomain: "vendor.example",
        subject: "Thanks for taking the test",
        bodyText: "Thanks for taking the test",
        receivedAt: new Date("2026-01-05T12:00:00Z"),
        classificationStatus: "OK",
        classifierVersion: CLASSIFIER_VERSION,
        isApplicationRelated: true,
        isSignificant: false,
        emailTitle: "Assessment Completed",
        llmClassificationRaw: JSON.stringify({
          is_application_related: true,
          company_name: company,
          role_title: null,
          status: "IN_PROGRESS",
          stage_detail: "ASSESSMENT",
          email_event: "COMPLETION",
          sender_role: "ASSESSMENT_VENDOR",
          is_significant: false,
          email_title: "Assessment Completed",
          confidence_score: 0.95,
        }),
      },
    });
  }

  /** How many rows the loose email ended up on. */
  async function landedOn(): Promise<number[]> {
    const message = await prisma.emailMessage.findFirstOrThrow({
      where: { gmailMessageId: { endsWith: "-loose" } },
    });
    return (await applicationsOf(prisma, message.id)).sort((a, b) => a - b);
  }

  async function run(
    answer: number[] | null,
    forCompany: string,
    stage: string | null = null,
  ): Promise<number[]> {
    const rows = await twoWaiting(forCompany, stage);
    await loose(forCompany);
    let asked = 0;
    const outcome = await match(prisma, async (_message, candidates) => {
      asked += 1;
      if (answer === null) return null;
      return { chosen: answer.map((index) => candidates[index]?.id ?? -1), costUsd: 0.001 };
    });
    await recompute(prisma, outcome.touched);
    const landed = await landedOn();
    expect(`the adjudicator is asked exactly once for ${forCompany}`, asked === 1);
    return [rows.length, landed.length];
  }

  // It plainly belongs to one of them: the adjudicator picks it, and fan out
  // does not reach the other.
  expect("two level candidates and one answer means one row", (await run([0], "Adjudicone"))[1] === 1);
  await clearSeeds();

  // It plainly belongs to both: the answer goes through the same fan out
  // safety rules, so both are reached.
  expect("two level candidates and both named means two rows", (await run([0, 1], "Adjudictwo"))[1] === 2);
  await clearSeeds();

  // None of them. A new application, which is what "none" means.
  expect("none of them means a new application rather than a guess", (await run([], "Adjudicnone"))[1] === 1);
  await clearSeeds();

  // Out of credit, unreachable, or an answer that would not parse. A paid call
  // may never be load bearing, so the score decides exactly as it would have.
  expect(
    "an adjudicator that cannot answer leaves the score to decide, as it always did",
    (await run(null, "Adjudicdown"))[1] === 1,
  );
  await clearSeeds();

  // Trigger 2: both rows are waiting on the very step this email is about, so
  // fan out would reach both. Asking can only narrow it.
  expect(
    "an answer narrows a fan out that would have reached both",
    (await run([0], "Adjudicnarrow", "ASSESSMENT"))[1] === 1,
  );
  await clearSeeds();
  expect(
    "and an adjudicator that cannot answer leaves fan out reaching both",
    (await run(null, "Adjudicwide", "ASSESSMENT"))[1] === 2,
  );
  await clearSeeds();
}

// ----------------------------------------------------------------- repair
//
// A grouping decision made on partial evidence is revisited
// once when the evidence is complete, and never more than once.
//
// Driven against boards built here rather than through the matching rules,
// because the matching rules are good enough that producing a genuine merge
// suspect through them takes contortion, and a fixture that has to be
// contorted is testing the contortion. The repair is a function of the board,
// so the board is what these hand it.


{
  // Two rows a shared posting number proves are one. Stage 4 filed them apart
  // because the titles disagreed when each arrived.
  await seedApplication(seedAccount, {
    company: "Repairco",
    role: "Alpha Intern",
    emails: [{ day: "2026-01-01", subject: "Application received, job number 771001" }],
  });
  await seedApplication(seedAccount, {
    company: "Repairco",
    role: "Beta Intern",
    emails: [{ day: "2026-01-03", subject: "Next steps for job number 771001" }],
  });

  const counters = emptyCounters();
  const outcome = await repairGrouping(prisma, counters);
  expect(
    "two rows a shared posting number proves are one get merged",
    counters.repairMerges === 1 && outcome.actions[0]?.kind === "MERGE",
  );
  await clearSeeds();
}

{
  // One row holding two disjoint posting numbers is two applications. The
  // matching rules already refuse to build this, so the repair is where you
  // find out that something did.
  await seedApplication(seedAccount, {
    company: "Splitco",
    role: "Systems Intern",
    emails: [
      { day: "2026-01-01", subject: "Application received, job number 880001" },
      { day: "2026-01-02", subject: "Application received, job number 880002" },
    ],
  });

  const counters = emptyCounters();
  await repairGrouping(prisma, counters);
  expect("one row holding two disjoint posting numbers gets split", counters.repairSplits === 1);
  await clearSeeds();
}

{
  // The same board, except the second email is on the row because it shares a
  // thread with the first. That is the employer's own system speaking and the
  // repair does not get to overrule it on the strength of a number.
  await seedApplication(seedAccount, {
    company: "Threadco",
    role: "Systems Intern",
    emails: [
      { day: "2026-01-01", subject: "Application received, job number 990001" },
      { day: "2026-01-02", subject: "Application received, job number 990002", reason: "THREAD" },
    ],
  });

  const counters = emptyCounters();
  await repairGrouping(prisma, counters);
  expect("a repair that would undo a thread link declines", counters.repairSplits === 0);
  await clearSeeds();
}

{
  // Three rows any two of which would merge. The pass makes one move, refuses
  // to touch a row twice, and counts what it left rather than chasing it.
  for (const role of ["Gamma Intern", "Gamma Intern", "Gamma Intern"]) {
    await seedApplication(seedAccount, {
      company: "Oscillo",
      role,
      emails: [{ day: "2026-01-01", subject: "Application received" }],
    });
  }

  const counters = emptyCounters();
  await repairGrouping(prisma, counters);
  expect(
    "a row already touched is left alone, and the leftover work is counted rather than chased",
    counters.repairMerges === 1 && counters.repairUnsettled === 2,
  );
  await clearSeeds();
}

// ------------------------------------------------------- split suspects
//
// The alarm that exists to doubt the matcher may not assume the matcher was
// right. It used to skip any pair whose titles agree, reasoning that two rows
// the matcher considered the same job would already have been merged; when the
// matcher could not reach the pair, the report that would have caught it fell
// silent. Seeded here rather than driven through matching, for the same reason
// the repair fixtures are: with the blocking rule in place the matching rules
// will not build this board, which is the point.

const { findSplitSuspects } = await import("../src/lib/pipeline/duplicates");

{
  await seedApplication(seedAccount, {
    company: "Ambrose Freight",
    role: "Systems Intern",
    emails: [{ day: "2026-01-01", subject: "Application received" }],
  });
  await seedApplication(seedAccount, {
    company: "Ambrose Freight",
    role: "Systems Intern",
    emails: [{ day: "2026-01-03", subject: "Application received" }],
  });

  // Filtered to the seeded employer, because the seeds sit on top of the
  // fixture board rather than replacing it.
  const found = (await findSplitSuspects(prisma)).filter((row) => row.company === "ambrose freight");
  expect(
    "two rows at one employer whose titles agree are reported, not assumed away",
    found.length === 1 && found[0].titlesAgree === true,
  );
  await clearSeeds();
}

{
  // The other half of the same rule: narrowing still narrows. Two employers
  // that share no word are never compared, however alike their titles read.
  await seedApplication(seedAccount, {
    company: "Ambrose Freight",
    role: "Systems Intern",
    emails: [{ day: "2026-01-01", subject: "Application received" }],
  });
  await seedApplication(seedAccount, {
    company: "Pellworth Rail",
    role: "Systems Intern",
    emails: [{ day: "2026-01-03", subject: "Application received" }],
  });

  const across = await findSplitSuspects(prisma);
  expect(
    "two employers are never a split suspect, however alike their titles read",
    !across.some((row) => row.company === "ambrose freight" || row.company === "pellworth rail"),
  );
  await clearSeeds();
}

{
  // Different posting numbers is the employer saying these are two
  // applications. That is an answer and not a suspect, titles or no titles.
  await seedApplication(seedAccount, {
    company: "Ambrose Freight",
    role: "Systems Intern",
    emails: [{ day: "2026-01-01", subject: "Application received, job number 660001" }],
  });
  await seedApplication(seedAccount, {
    company: "Ambrose Freight",
    role: "Systems Intern",
    emails: [{ day: "2026-01-03", subject: "Application received, job number 660002" }],
  });

  const numbered = await findSplitSuspects(prisma);
  expect(
    "two posting numbers still answer the question, so no suspect is reported",
    !numbered.some((row) => row.company === "ambrose freight"),
  );
  await clearSeeds();
}

// ---------------------------------------------------------------- aliases
//
// A rule may believe what it observed. It may not believe
// what it guessed as strongly as what it observed. An alias outlives every
// email that made it and nothing but a rebuild removes it, so it may only come
// from a match somebody could point at.

const aliases = await prisma.companyAlias.findMany({ orderBy: { aliasNormalized: "asc" } });

expect(
  "every alias records the link that made it",
  aliases.length > 0 && aliases.every((alias) => alias.reason !== null),
);
expect(
  "no alias was written from a score, a hand off or a fan out",
  aliases.every((alias) => ["NEW", "THREAD", "REQUISITION", "TITLE"].includes(alias.reason ?? "")),
);
expect(
  "a thread match still writes one, because a shared thread is something the employer did",
  aliases.some((alias) => alias.reason === "THREAD"),
);
// Wayne Systems is the fixture where two postings are both waiting on an
// assessment and a vendor's paper can say which. Before this rule, matching
// that paper wrote an alias from a guess.
expect(
  "an exam vendor's paper writes no alias, however it was filed",
  !aliases.some((alias) => alias.aliasNormalized.includes("engineering test")),
);

// ------------------------------------------------------------- the title
//
// A stated string used to be a stated title, full stop. That is how the name of
// a message template became the name of a job and split one application into
// two rows. The model is now asked the general question, and a string that is
// not a posting name is stored as no title.

const { termBucket } = await import("../src/lib/constants");
const {
  dedupeKey: keyOf,
  groupsOf,
  normalizeCompany,
  normalizeTerm,
  rolesMatch,
  sameEmployer,
  termsMatch,
} = await import("../src/lib/normalize");
const { parseClassification } = await import("../src/lib/llm/types");

const read = (answer: Record<string, unknown>) =>
  parseClassification({ is_application_related: true, status: "APPLIED", ...answer });

expect(
  "a title the model says names the posting is kept",
  read({ role_title: "Engineering Intern", role_title_is_posting: true }).roleTitle ===
    "Engineering Intern",
);
expect(
  "a title the model says belongs to the sending system is stored as no title",
  read({ role_title: "US Intern Template", role_title_is_posting: false }).roleTitle === null,
);
expect(
  "and the refusal is recorded rather than left to be inferred from the silence",
  read({ role_title: "US Intern Template", role_title_is_posting: false }).roleTitleIsPosting ===
    false &&
    read({ role_title: null, role_title_is_posting: null }).roleTitleIsPosting === null,
);
expect(
  "an answer written before the question existed keeps its title, because silence is not a refusal",
  read({ role_title: "Engineering Intern" }).roleTitle === "Engineering Intern" &&
    read({ role_title: "Engineering Intern" }).roleTitleIsPosting === true,
);
expect(
  "a refused title still attaches, because silence is agreement to the title comparison",
  rolesMatch(null, "Engineering Intern") && rolesMatch("Engineering Intern", null),
);

// --------------------------------------------------------------- blocking
//
// Every narrowing step in this system runs through `groupsOf`, and every one
// of them rests on one property:
//
//   Every pair `sameEmployer` would accept is a pair retrieval returned.
//
// It used to be claimed in a comment above the retrieval that did not have it,
// which is how one posting sat on the board as two rows with the alarm for it
// silent. So it is swept rather than asserted in prose.

/**
 * The names to sweep: shapes rather than a mailbox, so the check travels.
 *
 * Every shape a real employer writes itself in, written in names nobody has:
 * a short form and a long one, a long one that leads with a different word
 * from the short one, a run together spelling, a connector in the middle, a
 * leading "the", and two firms that share a word without sharing an employer.
 */
const SWEEP = [
  "harrow", "north harrow", "the north harrow company", "harrow worldwide",
  "penroseholt", "penrose holt", "penrose holt and co",
  "acme", "global acme", "acme global systems", "acmeglobal",
  "guild of masons", "guildofmasons", "guild", "masons",
  "x", "x y", "y x", "x y z", "xyz", "zyx",
  "meridian", "meridian holdings", "meridianholdings",
  "orb", "starwake", "star wake", "vantage one", "vantageone", "one vantage",
].map(normalizeCompany);

const shareAKey = (left: string, right: string) => {
  const keys = new Set(groupsOf(left));
  return groupsOf(right).some((key) => keys.has(key));
};

const missed: string[] = [];
for (const left of SWEEP) {
  for (const right of SWEEP) {
    if (left === right) continue;
    if (sameEmployer(left, right) && !shareAKey(left, right)) missed.push(`${left} / ${right}`);
  }
}

expect(
  `retrieval returns every pair sameEmployer accepts${missed.length ? `, missed ${missed.join(", ")}` : ""}`,
  missed.length === 0,
);

// The shape the shared key rule exists for, named rather than left to the
// sweep, so a change that breaks it says which change it broke: a long form
// whose leading word is not the short form's.
expect(
  "an email naming an employer's long form reaches the row filed under its short form",
  shareAKey("north harrow", "harrow") && sameEmployer("north harrow", "harrow"),
);
expect(
  "and it reaches it in both directions, which a prefix lookup never did",
  shareAKey("harrow", "north harrow"),
);
expect(
  "a run together spelling is a key of its own name, so no alias has to stand in for it",
  shareAKey("penroseholt", "penrose holt") && shareAKey("vantageone", "vantage one"),
);
expect(
  "narrowing still narrows: two employers sharing no word are never compared",
  !shareAKey("harrow", "starwake") && !shareAKey("orb", "meridian"),
);

// -------------------------------------------------------------- the term
//
// A vocabulary stopped being a filter on what may be recorded. The term an
// email states is kept as it states it; the buckets decide which column it is
// filed under and nothing else, so a term no bucket fits is stored and counted
// rather than dropped.


expect(
  "a term the buckets cannot hold is kept rather than dropped",
  read({ term: "Michaelmas" }).term === "Michaelmas" && read({ term: "Michaelmas" }).season === null,
);
expect(
  "and one they can is kept too, with the bucket derived beside it",
  read({ term: "Winter" }).term === "Winter" && read({ term: "Winter" }).season === "Winter",
);
expect(
  "a term naming two seasons files under the first the list names, so the answer never drifts",
  termBucket("Winter/Spring") === "Spring" && termBucket("Spring/Winter") === "Spring",
);
expect(
  "an answer written before the field was renamed still says what it said",
  read({ season: "Summer" }).term === "Summer" && read({ season: "Summer" }).season === "Summer",
);
expect(
  "the year is a field of its own, so it is not read out of the term",
  normalizeTerm("Winter 2027") === "winter" && normalizeTerm(" WINTER ") === "winter",
);
expect(
  "two postings the buckets cannot tell apart still hold different identity keys",
  keyOf({ companyNormalized: "acme", roleTitle: "Intern", term: "Michaelmas", year: 2027 }) !==
    keyOf({ companyNormalized: "acme", roleTitle: "Intern", term: "Hilary", year: 2027 }),
);
expect(
  "and matching compares the stated terms rather than the bucket",
  !termsMatch("Winter", "Summer") &&
    termsMatch("Winter 2027", "winter") &&
    termsMatch(null, "Winter"),
);

{
  // One posting name, two terms. Before the term survived being read there was
  // nothing on either row to tell them apart, so the second confirmation walked
  // onto the first row and two applications became one.
  await seedApplication(seedAccount, {
    company: "Fenchurch Optics",
    role: "Software Engineer Intern",
    term: "Summer",
    emails: [{ day: "2026-01-01", subject: "Thank you for applying" }],
  });
  await seedApplication(seedAccount, {
    company: "Fenchurch Optics",
    role: "Software Engineer Intern",
    term: "Winter",
    emails: [{ day: "2026-01-02", subject: "Thank you for applying" }],
  });

  const counters = emptyCounters();
  await repairGrouping(prisma, counters);
  expect(
    "one posting name in two terms is two applications, and the repair leaves them apart",
    counters.repairMerges === 0,
  );
  await clearSeeds();
}

{
  // The other direction, so the rule is a contradiction rather than a
  // requirement: silence contradicts nothing, and two rows one of which names
  // no term still merge on their titles.
  await seedApplication(seedAccount, {
    company: "Fenchurch Optics",
    role: "Software Engineer Intern",
    term: "Summer",
    emails: [{ day: "2026-01-01", subject: "Thank you for applying" }],
  });
  await seedApplication(seedAccount, {
    company: "Fenchurch Optics",
    role: "Software Engineer Intern",
    emails: [{ day: "2026-01-02", subject: "Thank you for applying" }],
  });

  const counters = emptyCounters();
  await repairGrouping(prisma, counters);
  expect(
    "a row that names no term contradicts nothing, so silence is still not a disagreement",
    counters.repairMerges === 1,
  );
  await clearSeeds();
}

// ----------------------------------------------------- nothing in silence
//
// > Gate 10. A message leaves stage 4 with a membership or with a counted
// > reason, and never with neither.
//
// A name the code will not accept is an answer it could not use, not an answer
// it never got. `isBlockedCompany` used to erase the model's answer in the
// parser, and stage 4 then dropped the message down a bare `continue` that
// nothing counted.

expect(
  "a vendor named as the employer is recorded as refused rather than deleted",
  read({ company_name: "Workday" }).companyName === null &&
    read({ company_name: "Workday" }).companyRefused === "Workday",
);
expect(
  "an email that names nobody is a different answer from one whose name was refused",
  read({ company_name: null }).companyRefused === null &&
    read({ company_name: null }).companyName === null,
);
expect(
  "a name the code accepts is untouched, and carries no refusal",
  read({ company_name: "Larkspur Analytics" }).companyName === "Larkspur Analytics" &&
    read({ company_name: "Larkspur Analytics" }).companyRefused === null,
);

{
  // Three messages stage 4 cannot file and one it can. Before this the first
  // two went down the same silent branch and nothing anywhere counted either.
  const unfilable = [
    { id: "gate10-refused", company: "Workday", role: "Software Development Engineer Intern" },
    { id: "gate10-nameless", company: null, role: null },
    { id: "gate10-empty", company: "   ...   ", role: null },
    { id: "gate10-real", company: "Larkspur Analytics", role: "Data Intern" },
  ];

  for (const [index, seed] of unfilable.entries()) {
    await prisma.emailMessage.create({
      data: {
        gmailAccountId: seedAccount,
        gmailMessageId: seed.id,
        threadId: seed.id,
        senderEmail: "careers@seed.example",
        senderDomain: "seed.example",
        subject: `Gate 10 fixture ${index}`,
        bodyText: `Gate 10 fixture ${index}`,
        receivedAt: new Date(`2026-03-0${index + 1}T12:00:00Z`),
        classificationStatus: "OK",
        classifierVersion: CLASSIFIER_VERSION,
        isApplicationRelated: true,
        isSignificant: true,
        emailTitle: "Seed",
        llmClassificationRaw: JSON.stringify({
          is_application_related: true,
          company_name: seed.company,
          role_title: seed.role,
          status: "APPLIED",
          is_significant: true,
          email_title: "Seed",
          confidence_score: 0.9,
        }),
      },
    });
  }

  const outcome = await attachClassified(prisma);
  const skips = outcome.counters.skipsByReason;
  const skipped = Object.values(skips).reduce((sum, n) => sum + n, 0);

  expect(
    `stage 4 balances: ${outcome.attached} attached plus ${skipped} counted against ${outcome.given} given`,
    outcome.given >= 4 && outcome.attached + skipped === outcome.given,
  );
  expect(
    "a refused name and a missing one are counted apart, because they are different answers",
    skips.COMPANY_REFUSED >= 1 && skips.NO_COMPANY >= 1,
  );
  expect(
    "a name that normalises away to nothing is counted as its own reason",
    skips.COMPANY_UNREADABLE >= 1,
  );
  expect(
    "and the one message that could be filed was filed rather than counted",
    outcome.attached >= 1,
  );

  await prisma.applicationMembership.deleteMany({
    where: { message: { gmailMessageId: { startsWith: "gate10-" } } },
  });
  await prisma.emailMessage.deleteMany({ where: { gmailMessageId: { startsWith: "gate10-" } } });
  await prisma.application.deleteMany({ where: { companyNormalized: "larkspur analytics" } });
}

// ------------------------------------------------------------ the ending
//
// `status` says one word for several different facts, so an offer nobody had
// answered read Accepted and a withdrawal the applicant made read Rejected.
// `outcome` is stored on every row and was read by nothing. One rule now says
// what a finished row says, and both designs read it.

const { endingLabel } = await import("../src/lib/view");
const { OUTCOMES } = await import("../src/lib/constants");

expect(
  "an offer nobody has answered says Offer rather than Accepted",
  endingLabel({ status: "ACCEPTED", outcome: "OFFER_EXTENDED" }) === "Offer",
);
expect(
  "a withdrawal says Application Withdrawn rather than Rejected",
  endingLabel({ status: "REJECTED", outcome: "WITHDRAWN_BY_APPLICANT" }) === "Application Withdrawn",
);
expect(
  "a posting that went away does not say anybody was turned down",
  endingLabel({ status: "REJECTED", outcome: "POSTING_CANCELLED" }) === "Posting Cancelled",
);
expect(
  "a row that ended and no email said how reads Application Closed",
  endingLabel({ status: "REJECTED", outcome: null }) === "Application Closed" &&
    endingLabel({ status: "ACCEPTED", outcome: null }) === "Application Closed",
);
expect(
  "a row that has not ended says nothing, so status keeps sectioning the board",
  endingLabel({ status: "APPLIED", outcome: null }) === null &&
    endingLabel({ status: "IN_PROGRESS", outcome: null }) === null,
);
expect(
  "every ending the vocabulary distinguishes is a word the board can say",
  OUTCOMES.every(
    (outcome) => endingLabel({ status: "REJECTED", outcome }) !== "Application Closed",
  ),
);

// --------------------------------------------------------- one employer
//
// Three postings at one employer is three rows and one name. The rule that
// picks the name is the commonest wording rule that already ran inside a row,
// given every email at the employer instead of every email of one row, and it
// is a projection: writing it back would rewrite `company_normalized`, which is
// half of what decides which row an email belongs to.

const { displayCompanyNames } = await import("../src/lib/pipeline/employers");

const said = (company: string, day: string) => ({
  receivedAt: new Date(`${day}T00:00:00Z`),
  llmClassificationRaw: JSON.stringify({ is_application_related: true, company_name: company, status: "APPLIED" }),
});

const spelled = displayCompanyNames([
  { id: 1, companyName: "Northwind Trading", companyNormalized: "northwind trading", messages: [said("Northwind Trading", "2026-01-02")] },
  { id: 2, companyName: "NorthwindTrading", companyNormalized: "northwindtrading", messages: [said("NorthwindTrading", "2026-01-03"), said("NorthwindTrading", "2026-01-04")] },
  { id: 3, companyName: "Southport Rail", companyNormalized: "southport rail", messages: [said("Southport Rail", "2026-01-05")] },
]);

expect(
  "three postings at one employer wear one name, and the commonest wording is it",
  spelled.get(1) === "NorthwindTrading" && spelled.get(2) === "NorthwindTrading",
);
expect(
  "a different employer keeps its own name",
  spelled.get(3) === "Southport Rail",
);

const tied = displayCompanyNames([
  { id: 1, companyName: "Eastgate Foods", companyNormalized: "eastgate foods", messages: [said("Eastgate Foods", "2026-01-02")] },
  { id: 2, companyName: "EastgateFoods", companyNormalized: "eastgatefoods", messages: [said("EastgateFoods", "2026-01-09")] },
]);
expect(
  "a dead heat goes to the earliest email, so the answer never depends on row order",
  tied.get(1) === "Eastgate Foods" && tied.get(2) === "Eastgate Foods",
);

const aliased = displayCompanyNames(
  [
    { id: 1, companyName: "Meridian", companyNormalized: "meridian", messages: [said("Meridian", "2026-01-02")] },
    { id: 2, companyName: "Halcyon Group", companyNormalized: "halcyon", messages: [said("Halcyon Group", "2026-01-03")] },
  ],
  [{ aliasNormalized: "halcyon", canonicalCompanyName: "Meridian" }],
);
expect(
  "two names with nothing in common still wear one, when an alias witnessed it",
  aliased.get(1) === aliased.get(2),
);

const silent = displayCompanyNames([
  { id: 1, companyName: "Quiet Works", companyNormalized: "quiet works", messages: [] },
]);
expect(
  "a row whose emails name nobody keeps the name it already had",
  silent.get(1) === "Quiet Works",
);

// -------------------------------------------------------------- prefilter
//
// The junk filter runs before the model, so anything it
// drops is invisible to every metric computed over the board. It may therefore
// only remove what is certainly not an application, and it may never contradict
// a rule the prompt states.

const { prefilter } = await import("../src/lib/prefilter");

function kept(subject: string, sender = "no-reply@careers.example"): boolean {
  return prefilter({ senderEmail: sender, senderDomain: sender.split("@")[1], subject }).keep;
}

expect(
  "an identity check naming its posting reaches the model",
  kept("Verify your email to complete your application for Systems Intern") &&
    kept("Please verify your identity for the Software Engineer Intern position") &&
    kept("Security alert: confirm it was you who submitted an application"),
);
expect(
  "a bare passcode naming no application still reaches the model, and rule 4 is what rejects it",
  kept("Password reset request") && kept("Verify your account"),
);
expect(
  "the digest rules are untouched, so the filter still does the job it is for",
  !kept("12 new jobs for you", "jobalerts-noreply@linkedin.com") && // the digest sender list is a cache of names by design and a fixture for it has to name one
    !kept("Your weekly job digest") &&
    !kept("Recommended jobs you may be interested in") &&
    !prefilter({ senderEmail: "alerts@indeed.com", senderDomain: "indeed.com", subject: "Anything" }).keep,
);

let failures = 0;
for (const [label, ok] of expectations) {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
}

await prisma.$disconnect();
process.exit(failures ? 1 : 0);
