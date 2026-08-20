-- CreateTable
CREATE TABLE "user_settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1 CHECK ("id" = 1),
    "llm_provider" TEXT,
    "llm_api_key_encrypted" TEXT,
    "read_from_date" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "gmail_accounts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email_address" TEXT NOT NULL,
    "display_name" TEXT,
    "refresh_token" TEXT NOT NULL,
    "access_token" TEXT,
    "token_expires_at" DATETIME,
    "connected_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_sync_at" DATETIME,
    "is_active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "email_messages" (
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
    CONSTRAINT "email_messages_gmail_account_id_fkey" FOREIGN KEY ("gmail_account_id") REFERENCES "gmail_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "email_messages_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "applications" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "company_name" TEXT NOT NULL,
    "company_normalized" TEXT NOT NULL,
    "company_domain" TEXT,
    "role_title" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "season" TEXT,
    "year" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "stage_detail" TEXT,
    "status_override" TEXT,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "first_email_at" DATETIME,
    "latest_email_at" DATETIME,
    "ats_vendor" TEXT,
    "confidence" REAL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "application_status_history" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "application_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "message_id" INTEGER NOT NULL,
    "detected_at" DATETIME NOT NULL,
    CONSTRAINT "application_status_history_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "application_status_history_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "email_messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "company_aliases" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "alias_normalized" TEXT NOT NULL,
    "canonical_company_name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" DATETIME,
    "mode" TEXT NOT NULL,
    "messages_discovered" INTEGER NOT NULL DEFAULT 0,
    "messages_fetched" INTEGER NOT NULL DEFAULT 0,
    "messages_classified" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "error_summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING'
);

-- CreateTable
CREATE TABLE "llm_usage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sync_run_id" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cost_usd" REAL NOT NULL,
    CONSTRAINT "llm_usage_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "sync_runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "gmail_accounts_email_address_key" ON "gmail_accounts"("email_address");

-- CreateIndex
CREATE INDEX "email_messages_thread_id_idx" ON "email_messages"("thread_id");

-- CreateIndex
CREATE INDEX "email_messages_classification_status_idx" ON "email_messages"("classification_status");

-- CreateIndex
CREATE INDEX "email_messages_application_id_idx" ON "email_messages"("application_id");

-- CreateIndex
CREATE INDEX "email_messages_received_at_idx" ON "email_messages"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_gmail_account_id_gmail_message_id_key" ON "email_messages"("gmail_account_id", "gmail_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "applications_dedupe_key_key" ON "applications"("dedupe_key");

-- CreateIndex
CREATE INDEX "applications_company_normalized_idx" ON "applications"("company_normalized");

-- CreateIndex
CREATE INDEX "applications_status_idx" ON "applications"("status");

-- CreateIndex
CREATE INDEX "applications_latest_email_at_idx" ON "applications"("latest_email_at");

-- CreateIndex
CREATE INDEX "applications_season_year_idx" ON "applications"("season", "year");

-- CreateIndex
CREATE INDEX "application_status_history_application_id_idx" ON "application_status_history"("application_id");

-- CreateIndex
CREATE UNIQUE INDEX "application_status_history_application_id_message_id_status_key" ON "application_status_history"("application_id", "message_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "company_aliases_alias_normalized_key" ON "company_aliases"("alias_normalized");
