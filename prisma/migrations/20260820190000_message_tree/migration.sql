-- Being a repeat is one case of being shown under an earlier email, so it
-- becomes that relation rather than having three more nullable columns bolted
-- beside it (LOOP2 3.1).
--
-- This adds and never removes: every value already in repeat_of_message_id
-- carries over unchanged, and comes out the other side labelled REPEAT, which
-- is what it always meant.
--
-- SQLite cannot add a CHECK to a table that already exists, and rule 4 in
-- LOOP2 3.2 needs one, so the whole table is rebuilt in the twelve step style
-- the CHECK (id = 1) on user_settings already uses.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

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
    "application_id" INTEGER,
    "parent_message_id" INTEGER,
    "parent_relation" TEXT,
    -- The two columns are one fact held in two places, so neither may stand
    -- without the other.
    CONSTRAINT "email_messages_parent_relation_check" CHECK (
        ("parent_message_id" IS NULL AND "parent_relation" IS NULL)
        OR ("parent_message_id" IS NOT NULL AND "parent_relation" IS NOT NULL)
    ),
    CONSTRAINT "email_messages_gmail_account_id_fkey" FOREIGN KEY ("gmail_account_id") REFERENCES "gmail_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "email_messages_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "email_messages_parent_message_id_fkey" FOREIGN KEY ("parent_message_id") REFERENCES "email_messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_email_messages" (
    "id", "gmail_account_id", "gmail_message_id", "rfc822_message_id", "thread_id",
    "sender_name", "sender_email", "sender_domain", "subject", "snippet", "body_text",
    "labels", "received_at", "classification_status", "classifier_version", "llm_model",
    "classification_attempts", "classification_error", "is_application_related",
    "is_significant", "email_title", "llm_classification_raw", "application_id",
    "parent_message_id", "parent_relation"
)
SELECT
    "id", "gmail_account_id", "gmail_message_id", "rfc822_message_id", "thread_id",
    "sender_name", "sender_email", "sender_domain", "subject", "snippet", "body_text",
    "labels", "received_at", "classification_status", "classifier_version", "llm_model",
    "classification_attempts", "classification_error", "is_application_related",
    "is_significant", "email_title", "llm_classification_raw", "application_id",
    "repeat_of_message_id",
    CASE WHEN "repeat_of_message_id" IS NULL THEN NULL ELSE 'REPEAT' END
FROM "email_messages";

DROP TABLE "email_messages";
ALTER TABLE "new_email_messages" RENAME TO "email_messages";

CREATE INDEX "email_messages_thread_id_idx" ON "email_messages"("thread_id");
CREATE INDEX "email_messages_classification_status_idx" ON "email_messages"("classification_status");
CREATE INDEX "email_messages_application_id_idx" ON "email_messages"("application_id");
CREATE INDEX "email_messages_received_at_idx" ON "email_messages"("received_at");
CREATE INDEX "email_messages_parent_message_id_idx" ON "email_messages"("parent_message_id");
CREATE UNIQUE INDEX "email_messages_gmail_account_id_gmail_message_id_key" ON "email_messages"("gmail_account_id", "gmail_message_id");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
