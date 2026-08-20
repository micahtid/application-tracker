# Internship Applications Tracker

A local first board that reads your Gmail and works out which applications you have running.
Nothing leaves your machine except two calls you can name: Gmail, and whichever LLM provider
you gave a key to.

`PRD.md` says what it does. `PLANNING.md` says why each decision was taken.

**New here?** Do [First time setup](#first-time-setup) first. Until it is done the app runs, but the
board is replaced by a Not Connected screen, because there is no inbox to read and no key to read it
with.

## Running it

Double click **`start.bat`**. It installs anything missing, applies database migrations, builds
once, then serves on <http://127.0.0.1:3939> and opens your browser.

For development instead: `npm run dev`.

The first launch takes a minute or two, since it installs dependencies and builds. Later launches
open straight away.

The server binds to `127.0.0.1` on purpose. It has no login, so it must never listen on
`0.0.0.0` where anyone on the same wireless network could read your inbox through it.

**Prisma stays on version 6 deliberately.** Version 7 drops the built in query engine and wants a
driver adapter, which on SQLite means `better-sqlite3`, a native module that has to compile. Avoiding
exactly that is why Prisma was chosen (D21), so do not let an upgrade pull it in.

## First time setup

Three things, once: a secret file that already exists, a Google OAuth client you create by hand,
and an API key you paste into Settings. Budget about fifteen minutes for the Google part the first
time. Nothing here recurs.

### 1. The secret file

`.env.local` was created for you with a fresh `APP_SECRET`. It is gitignored, and it is the one file
worth backing up separately: without it the saved API key cannot be decrypted. Losing it is not a
disaster, you just paste the key in again.

You will add two more lines to it in step 2.7 below.

### 2. A Google OAuth client

Google will not let an app read a Gmail inbox unless that app is registered as a project you own.
You are making that registration. Nothing in it is published, reviewed, or shared, and you are the
only user it will ever have.

By the end you will have: a project, the Gmail API turned on, an OAuth app that is **published** and
**unverified**, one read only scope, and a client ID and secret sitting in `.env.local`.

> **Where things live.** Google moved consent screen setup out of *APIs & Services* into a section
> called **Google Auth Platform**. Older guides that tell you to open *APIs & Services → OAuth
> consent screen* are describing the same settings under their previous name.

#### 2.1 Create a project

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project picker in the top bar, then **New project**.
3. Give it a name only you will read, such as `applications-tracker`. Leave the organisation alone.
4. Click **Create**, then make sure the picker now shows that project. Everything below applies to
   whichever project is selected, and configuring the wrong one is the most common way this goes
   sideways.

#### 2.2 Turn on the Gmail API

1. Menu (☰) → **APIs & Services** → **Library**.
2. Search for **Gmail API**, open it, and click **Enable**.

Without this, sign in still works and every sync fails with `Gmail API has not been used in project`.

#### 2.3 Set up the OAuth app

1. Menu (☰) → **Google Auth Platform** → **Branding**.
2. Click **Get started**. (This appears only the first time. If the project is already configured
   you will land straight on the Branding page, and can skip to 2.4.)
3. **App information** — **App name**: what you will see on the consent screen, such as
   `Applications Tracker`. **User support email**: your own address. → **Next**
4. **Audience** — choose **External**. Internal exists only inside a Google Workspace organisation,
   and a personal Gmail account cannot use it. → **Next**
5. **Contact information** — your email again, for Google's notices about the project. → **Next**
6. **Finish** — tick **I agree to the Google API Services: User Data Policy**, then **Continue** and
   **Create**.

#### 2.4 Add the Gmail read scope

1. **Google Auth Platform** → **Data access**.
2. Click **Add or remove scopes**. A panel opens with a filterable table of scopes.
3. `gmail.readonly` is a **restricted** scope and often will not show up in that table. Scroll to
   **Manually add scopes**, paste the line below, and click **Add to table**:

   ```
   https://www.googleapis.com/auth/gmail.readonly
   ```

4. Tick it, click **Update**, then **Save** on the Data access page.
5. Confirm it now appears under **Your restricted scopes**, and that it is the only one there. The
   sign in basics (`openid`, `userinfo.email`, `userinfo.profile`) need no adding: the app asks for
   them during sign in, and they are only how it learns which mailbox it just connected to.

This scope is read only. There is no scope here that can send, delete, or alter mail, and the app
never asks for one.

#### 2.5 Publish the app

1. **Google Auth Platform** → **Audience**.
2. Under **Publishing status** it will say **Testing**. Click **Publish app**, then confirm.
3. It should now read **In production**.

**Do not skip this.** While an external app sits in Testing, Google expires its refresh tokens after
**seven days**, so the app would quietly stop reading your mail every week and send you back to the
Reconnect screen. Publishing removes that expiry. This is decision D1 in `PLANNING.md`.

Publishing does **not** submit anything for review. Your app stays unverified, which has exactly two
consequences, both fine here:

- Every person who signs in sees a **"Google hasn't verified this app"** screen once. That is you,
  once.
- An unverified app is capped at 100 users in total. You are one.

Getting verified for a restricted scope means a third party security assessment (CASA), which takes
months and costs real money. That is out of scope for a tool with one user, on purpose.

#### 2.6 Create the client

1. **Google Auth Platform** → **Clients** → **Create client**.
2. **Application type**: **Web application**.
3. **Name**: anything, it is only shown in the console.
4. Under **Authorized redirect URIs**, click **Add URI** and paste this exactly:

   ```
   http://127.0.0.1:3939/api/auth/google/callback
   ```

   Exactly means exactly: `http` not `https`, `127.0.0.1` not `localhost` (Google treats them as
   different origins), port `3939`, and no trailing slash. A single character off and sign in ends
   at a `redirect_uri_mismatch` error page.

5. Click **Create**. A dialog shows **Client ID** and **Client secret**. Copy both now, or click
   **Download JSON**. You can reopen them later from the client's row on the Clients page.

#### 2.7 Put them in `.env.local`

```
GOOGLE_CLIENT_ID="1234567890-abcdefg.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-…"
GOOGLE_REDIRECT_URI="http://127.0.0.1:3939/api/auth/google/callback"
```

`GOOGLE_REDIRECT_URI` is already in the file and only needs changing if you move off port 3939. Move
it everywhere or nowhere: this line, the **Authorized redirect URIs** entry from 2.6, the `dev` and
`start` scripts in `package.json`, and the URL `start.bat` opens. Sign in breaks the moment two of
them disagree.

**Restart the app.** `.env.local` is read at boot, so a running server will not pick up the change,
and Settings will keep telling you no Google client is configured.

#### 2.8 Sign in

1. Open the app, then **Settings** → **Sign in**.
2. Pick the Google account whose mail you want read.
3. On **"Google hasn't verified this app"**, click **Advanced**, then
   **Go to {your app name} (unsafe)**. This is the screen from 2.5, and "unsafe" here means
   "unreviewed by Google", not "unsafe to you": the app is on your machine, you built it, and the
   scope is read only.
4. On the permission screen, **make sure the Gmail checkbox is ticked** before **Continue**. Google
   lets you approve sign in while declining the mail scope, and the result is an app that looks
   connected and fails on every sync with an insufficient scopes error.

You land back on the board, and the first sync starts.

### 3. Settings

Open Settings and fill in three things:

- **Gmail Account** — sign in, as above.
- **API Key** — from OpenRouter, Anthropic, or Gemini. **There is nothing to choose:** the provider
  is read off the key, since each stamps its own prefix (`sk-or-`, `sk-ant-`, `AIza`), and there is
  no model selector either, because each provider ships with one chosen model. **Check** calls that
  provider's model list endpoint, which is free, needs a working key, and confirms the model still
  exists; once it passes, the line under the field names the provider and model you will be using.
- **Read Emails From** — a start date, capped at 12 months ago.

Logging out clears the saved API key along with the account, since a key with no mailbox to read is
of no use. Your downloaded emails and their classifications survive it, so signing back in does not
pay for the backfill twice.

Save, and the first sync starts. It reads roughly 250 emails and classifies each one, which takes
a few minutes and costs about 20 cents. Every sync after that reads only what is new.

### When sign in goes wrong

| What you see | What it means | The fix |
|---|---|---|
| `redirect_uri_mismatch` | The URI in the console is not character for character the one the app sent | Re-read 2.6. Usually `localhost` instead of `127.0.0.1`, a trailing slash, or the wrong port |
| `invalid_client` or "The OAuth client was not found" | The ID or secret is wrong, or belongs to a different project | Re-copy both from the Clients page, then restart the app |
| `access_denied` | You closed the consent screen, or the app is still in Testing and you are not on its test user list | Publish the app (2.5), or add yourself under **Audience → Test users** |
| "Gmail API has not been used in project …" | The API was never enabled | Step 2.2, then wait a minute for it to take effect |
| "Request had insufficient authentication scopes" (403) | The Gmail checkbox was left unticked at consent | Settings → **Log out**, then **Sign in** again and tick it (2.8). Logging out also clears the saved API key, so have it to hand |
| The board keeps showing **Reconnect Gmail** | The refresh token was rejected | Sign in again. Google invalidates it when you revoke access, when you change your Google password (it holds Gmail scopes), after six months unused, or if the app is still in Testing |
| Settings says no Google client is configured | `.env.local` was edited while the server was running, or the values are empty | Save the file and restart |

To revoke this app's access entirely, use
[your Google account's third party access page](https://myaccount.google.com/connections). The app
holds nothing you cannot take back from there.

## What each provider costs

| Provider | Model | Input / MTok | Output / MTok |
|---|---|---|---|
| OpenRouter | `google/gemini-3.7-flash` | $0.375 | $1.875 |
| Anthropic | `claude-haiku-4-5` | $1.00 | $5.00 |
| Gemini | `gemini-3.7-flash` | $0.75 | $3.75 |

The running total is in Settings, for all time, and is never reset. Where a provider reports the
real cost on the response, as OpenRouter does, that figure is used instead of our own estimate.

## Forcing a fresh classification pass

Every result the model gives is saved and never re-requested. When you change the prompt, the junk
filter, or the chosen model, raise `CLASSIFIER_VERSION` in `src/lib/constants.ts`. The next sync
then re-reads every cached email, for the price of one backfill. This is deliberate rather than
automatic: without it, results from an old prompt would sit silently beside results from a new one.

## Checking the pipeline by hand

```
npm run check:pipeline
```

Runs stages 4 and 5 over made up emails in a throwaway database, and asserts the behaviours that
cannot be seen by looking at the board: two emails from one company make one row, a rejection
arriving after an interview wins, a scheduling reply writes no status, identity comes from the
oldest email, and running the whole thing again changes nothing. It never calls Gmail or a model.

Classifier accuracy itself is still reviewed by hand, in Prisma Studio.

## Looking at the data

```
npm run db:studio
```

Prisma Studio is how classifier accuracy gets reviewed by hand: sort `email_messages` by
`confidence_score`, or look at what the prefilter marked `SKIPPED_PREFILTER` and why.

## Layout

```
prisma/schema.prisma      the database
src/lib/gmail/            sweeping, fetching, MIME walking, body cleaning
src/lib/llm/              one adapter per provider, one shared output schema
src/lib/pipeline/         the five stages: fetch, classify, match, recompute, sync
src/app/api/              the routes the browser talks to
src/components/           the board, the toolbar, settings
prototype/                the original static prototype, kept as the visual reference
```
