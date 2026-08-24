-- LOOP4 Decision 1. Belonging to an application is a fact about a pair, so it
-- is stored on the pair.
--
-- Three columns leave `email_messages` and become one row of their own. The
-- point of dropping them rather than keeping them as a convenience is that
-- every read of an application's emails now has to go through the new table:
-- a call site somebody forgot is a compile error rather than a half correct
-- board nobody notices.
--
-- SQLite will not drop a column another table's foreign key mentions, so
-- `email_messages` is rebuilt rather than altered. That is the same
-- redefinition dance Prisma generates for this case, foreign keys and all.

PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS "application_membership" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "application_id" INTEGER NOT NULL,
    "message_id" INTEGER NOT NULL,
    "reason" TEXT,
    "parent_message_id" INTEGER,
    "parent_relation" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "application_membership_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "application_membership_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "email_messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "application_membership_parent_message_id_fkey" FOREIGN KEY ("parent_message_id") REFERENCES "email_messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    -- A relation is present exactly when a parent is. Half a fact is not a fact.
    CONSTRAINT "application_membership_relation_needs_parent" CHECK (("parent_message_id" IS NULL) = ("parent_relation" IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS "application_membership_application_id_message_id_key" ON "application_membership"("application_id", "message_id");
CREATE INDEX IF NOT EXISTS "application_membership_message_id_idx" ON "application_membership"("message_id");
CREATE INDEX IF NOT EXISTS "application_membership_parent_message_id_idx" ON "application_membership"("parent_message_id");

-- Carried across so the board does not vanish between this migration and the
-- next rebuild. `reason` is left null on these rows, because there is no honest
-- answer for a link made before the reason was recorded, and a rebuild replaces
-- every one of them.
INSERT OR IGNORE INTO "application_membership" ("application_id", "message_id", "reason", "parent_message_id", "parent_relation")
SELECT "application_id", "id", NULL, "parent_message_id", "parent_relation"
FROM "email_messages"
WHERE "application_id" IS NOT NULL;

CREATE TABLE "new_email_messages" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gmail_account_id" INTEGER NOT NULL,
    "gmail_message_id" TEXT NOT NULL,
    "rfc822_message_id" TEXT,
    "thread_id" TEXT,
    "sender_name" TEXT,
    "sender_email" TEXT,
    "sender_domain" TEXT,
    "subject" TEXT,
    "snippet" TEXT,
    "body_text" TEXT,
    "labels" TEXT,
    "received_at" DATETIME NOT NULL,
    "classification_status" TEXT NOT NULL DEFAULT 'PENDING',
    "classifier_version" INTEGER,
    "llm_model" TEXT,
    "classification_attempts" INTEGER NOT NULL DEFAULT 0,
    "classification_error" TEXT,
    "is_application_related" BOOLEAN,
    "is_significant" BOOLEAN,
    "email_title" TEXT,
    "llm_classification_raw" TEXT,
    CONSTRAINT "email_messages_gmail_account_id_fkey" FOREIGN KEY ("gmail_account_id") REFERENCES "gmail_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_email_messages" (
    "id", "gmail_account_id", "gmail_message_id", "rfc822_message_id", "thread_id",
    "sender_name", "sender_email", "sender_domain", "subject", "snippet", "body_text",
    "labels", "received_at", "classification_status", "classifier_version", "llm_model",
    "classification_attempts", "classification_error", "is_application_related",
    "is_significant", "email_title", "llm_classification_raw"
)
SELECT
    "id", "gmail_account_id", "gmail_message_id", "rfc822_message_id", "thread_id",
    "sender_name", "sender_email", "sender_domain", "subject", "snippet", "body_text",
    "labels", "received_at", "classification_status", "classifier_version", "llm_model",
    "classification_attempts", "classification_error", "is_application_related",
    "is_significant", "email_title", "llm_classification_raw"
FROM "email_messages";

DROP TABLE "email_messages";
ALTER TABLE "new_email_messages" RENAME TO "email_messages";

CREATE UNIQUE INDEX "email_messages_gmail_account_id_gmail_message_id_key" ON "email_messages"("gmail_account_id", "gmail_message_id");
CREATE INDEX "email_messages_thread_id_idx" ON "email_messages"("thread_id");
CREATE INDEX "email_messages_classification_status_idx" ON "email_messages"("classification_status");
CREATE INDEX "email_messages_received_at_idx" ON "email_messages"("received_at");

PRAGMA foreign_keys=ON;
