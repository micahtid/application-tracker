# Contributing

A small project with a narrow purpose, so the most useful thing to read first is what it will and
will not take.

## Running It

The README covers setup end to end, including the Google OAuth client you need before a single email
arrives. Follow it once, then use `npm run dev` while you work. You need Node 22 or newer, which
`.nvmrc` names.

## Before A Pull Request

```
npm run check
```

The type checker, the linter, the pipeline fixture suite, and the adapter tests. It is the gate CI
runs, it needs no key and no mailbox, and it has to pass. If your change touches how emails are
matched or grouped, add a fixture to `scripts/check-pipeline.mts` that fails without it.

Run `npm run build` too. A production build enforces things the type checker does not, especially at
the boundary between server and client code.

## What This Takes

It is a board that runs on one person's machine and reads one person's mail. That decides most of
it.

**Welcome:**

- Better matching, grouping, or classification, with a fixture that shows it.
- Another model provider behind the existing adapter interface.
- Fixes to the setup instructions, which are where people get stuck.
- Accessibility and keyboard fixes.

**Out of scope:**

- A server, an account, a login, or anything hosted. The app binds to `127.0.0.1` and has no
  authentication because nothing but the person at the keyboard can reach it.
- Telemetry, analytics, crash reporting, or any other call to a third party. It talks to two things:
  the Gmail API, and the model provider whose key you supplied.
- Anything needing write access to a mailbox. The scope is `gmail.readonly` and it stays that way.

## Never Paste Real Email

Not in an issue, not in a pull request, not in a fixture. Redact the employer, the sender and the
subject, or invent a message with the same shape. Every fixture in `scripts/check-pipeline.mts` is
invented for this reason.

## Two Things That Look Wrong And Are Not

- **`AGENTS.md` is generated.** `next dev` writes it and rewrites it. Do not hand edit it, and
  expect it to come back in your diff.
- **`eslint.config.mjs` writes out `eslint-config-next/core-web-vitals` rather than importing it.**
  The file says why at the top. It becomes one import again once `typescript-eslint` supports
  TypeScript 7.

## Known Gap

The Gemini adapter implements `classify` but not the optional `ask`, so the adjudicator never runs
for a Gemini key. Nothing breaks, because that path falls back to the ordinary rules, but a Gemini
user gets a slightly worse board and nothing on screen says so.
