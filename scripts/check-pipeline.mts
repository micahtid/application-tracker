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

  // Invariant: the guard is "exactly one". Two postings at one employer are
  // both waiting on an assessment here, so the vendor's email cannot say which
  // it belongs to, and a third row is the honest answer rather than a guess.
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
  // which is a distinction the stage vocabulary only gained in LOOP3, and the
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
  const applications = await prisma.application.findMany({
    orderBy: [{ companyName: "asc" }, { id: "asc" }],
    include: {
      messages: {
        select: { id: true, gmailMessageId: true, parentMessageId: true, parentRelation: true, isSignificant: true, subject: true },
        orderBy: { receivedAt: "asc" },
      },
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

const unattached = await prisma.emailMessage.count({ where: { applicationId: null } });

console.log(JSON.stringify(first, null, 2));

expect("thirty seven applications", first.length === 37);
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
  "two postings waiting on an assessment at once make a third row rather than a guess",
  first.filter((row) => row.company === "Wayne Systems").length === 3,
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
// the model's freeform title (LOOP3 P1).

const { drawerTitle, TITLE_KEYWORD_RULES } = await import("../src/lib/drawer");

function titleOf(parts: {
  status?: string;
  stage?: string | null;
  event?: string | null;
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
      is_application_related: true,
      is_significant: true,
      email_title: parts.title ?? "Whatever The Model Called It",
    }),
    parentMessageId: parts.relation ? 2 : null,
    parentRelation: parts.relation ?? null,
  });
}

expect("no branch of the display reads a word out of the model's title", TITLE_KEYWORD_RULES.length === 0);
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

let failures = 0;
for (const [label, ok] of expectations) {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}`);
}

await prisma.$disconnect();
process.exit(failures ? 1 : 0);
