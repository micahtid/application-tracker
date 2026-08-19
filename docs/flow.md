# How the app works

Read it top to bottom. The main column is what normally happens. A box on the right is a
shortcut the app takes instead of carrying on down, and every shortcut saves either a
download or money.

```text
┌─ 1 ───────────────────────────────────────────────────┐
│ You open the app, or press Refresh. That is the       │
│ only thing that ever starts a sync.                   │
└───────────────────────────┬───────────────────────────┘
                            │
                            v
┌─ 2 ───────────────────────────────────────────────────┐    ┌──────────────────────────────────┐
│ Is a mailbox connected, and was the last sync more    ├──> │ No. Nothing is fetched, and the  │
│ than five minutes ago?                                │    │ board draws itself from what is  │
│                                                       │    │ already saved.                   │
└───────────────────────────┬───────────────────────────┘    └──────────────────────────────────┘
                            │
                            v
┌─ 3 ───────────────────────────────────────────────────┐
│ Ask Gmail for every message matching our keyword      │
│ phrases, plus everything from a known hiring system.  │
│ Inbox, archive and trash, from your start date to     │
│ today. Spam is never read.                            │
└───────────────────────────┬───────────────────────────┘
                            │
                            v
┌─ 4 ───────────────────────────────────────────────────┐    ┌──────────────────────────────────┐
│ Have we already downloaded this message?              ├──> │ Yes. Skip it. Gmail is asked for │
│                                                       │    │ each email only once, ever.      │
└───────────────────────────┬───────────────────────────┘    └──────────────────────────────────┘
                            │
                            v
┌─ 5 ───────────────────────────────────────────────────┐
│ Download the new ones and save each email, with its   │
│ sender, subject, body text, date, thread and labels.  │
└───────────────────────────┬───────────────────────────┘
                            │
                            v
┌─ 6 ───────────────────────────────────────────────────┐    ┌──────────────────────────────────┐
│ Is it obviously not an application, such as a job     ├──> │ Yes. Mark it skipped, move on.   │
│ alert digest, a newsletter or an advert?              │    │ No model was involved, so this   │
│                                                       │    │ costs nothing.                   │
└───────────────────────────┬───────────────────────────┘    └──────────────────────────────────┘
                            │
                            v
┌─ 7 ───────────────────────────────────────────────────┐    ┌──────────────────────────────────┐
│ Has the model already read this email, under the      ├──> │ Yes. Reuse the saved answer.     │
│ version of the prompt we use today?                   │    │ This is what makes every sync    │
│                                                       │    │ after the first nearly free.     │
└───────────────────────────┬───────────────────────────┘    └──────────────────────────────────┘
                            │
                            v
┌─ 8 ───────────────────────────────────────────────────┐
│ Send the email to the model on its own. It sees the   │
│ sender, subject, date and the first 1,500 characters  │
│ of cleaned body, and nothing else.                    │
└───────────────────────────┬───────────────────────────┘
                            │
                            v
┌─ 9 ───────────────────────────────────────────────────┐
│ Save what comes back onto the email row, and record   │
│ the tokens and cost separately so Settings can show   │
│ what you have spent.                                  │
└───────────────────────────┬───────────────────────────┘
                            │
                            v
┌─ 10 ──────────────────────────────────────────────────┐
│ Attach the email to an application. Match on thread   │
│ first, then company name, then role. If nothing       │
│ matches, start a new application.                     │
└───────────────────────────┬───────────────────────────┘
                            │
                            v
┌─ 11 ──────────────────────────────────────────────────┐
│ Rebuild that application from all of its emails.      │
│ Company and role come from the oldest one, status     │
│ from the newest one that matters.                     │
└───────────────────────────┬───────────────────────────┘
                            │
                            v
┌─ 12 ──────────────────────────────────────────────────┐    ┌──────────────────────────────────┐
│ Did every message get through without failing?        ├──> │ No. A banner sits above the      │
│                                                       │    │ board saying what went wrong.    │
│                                                       │    │ Your saved applications stay.    │
└───────────────────────────┬───────────────────────────┘    └──────────────────────────────────┘
                            │
                            v
┌─ 13 ──────────────────────────────────────────────────┐
│ The board draws its four sections, Accepted, In       │
│ Progress, Applied and Rejected, straight from the     │
│ database.                                             │
└───────────────────────────────────────────────────────┘
```

Steps 4 to 11 happen once for every email. Step 8 has about ten emails in the air at a
time, because waiting on the model one at a time would be slow. Step 10 is the opposite:
it runs strictly one email at a time, oldest first, so that two emails from the same
company can never create the same application twice.

## What gets stored

| Table | One row per | What it holds |
|---|---|---|
| `EmailMessage` | email | Sender, subject, body, date, thread, labels, and everything the model decided about it |
| `Application` | application | Company, role, term and status. Every one of those is worked out from the emails, never typed in |
| `ApplicationStatusHistory` | status an email implied | The trail that the current status is calculated from |
| `LlmUsage` | model call | Tokens and cost, so Settings can total your spend |
| `SyncRun` | sync | Counts, live progress, and anything that failed |
| `GmailAccount` | mailbox | Refresh token and whether the connection still works |
| `UserSettings` | you | Provider, encrypted API key, and how far back to read |
| `CompanyAlias` | learned pair | Company names already matched to each other |

## The two caches

Both caches answer the same question, "have we done this already", and both answers live
on the email row itself.

1. **Downloads, at step 4.** A Gmail message ID already in the database is never fetched
   again. Message content never changes, so there would be nothing to gain.
2. **Classifications, at step 7.** An email the model has already read is never sent to it
   again.

The second one is the expensive half. It is why the first sync costs roughly twenty cents
and every sync after it costs close to nothing. The check is the saved result plus a
version number, so raising that version is how you deliberately make the app read every
email again after you have changed the prompt.

## What the model sees, and what it gives back

**It sees** the sender, the subject, the date, and the first 1,500 characters of the
cleaned body. One email per request. Never a whole thread, and never the footer, because
"Powered by Greenhouse" at the bottom of an email is how a classifier ends up believing
the company is Greenhouse.

**It gives back** whether this is application mail at all, the company, its domain, the
role, the season and year, the status, whether the stage is an assessment or an interview,
whether the email is worth showing, a short title for it, a confidence number, and a
summary.

## Why running it twice is safe

Nothing in this flow writes a value it could not work out again. Run the whole thing a
second time over the same mailbox and you get the same board, because an application's
company and role always come from its oldest email and its status always comes from its
newest significant one. The only two things that survive untouched are the ones you set
by hand: hiding a row, and overriding its status.
