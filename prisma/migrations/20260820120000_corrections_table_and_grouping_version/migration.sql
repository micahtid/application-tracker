-- CreateTable
CREATE TABLE "application_corrections" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "anchor_message_id" INTEGER NOT NULL,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "status_override" TEXT,
    "company_snapshot" TEXT,
    "role_snapshot" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "application_corrections_anchor_message_id_fkey" FOREIGN KEY ("anchor_message_id") REFERENCES "email_messages" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "application_corrections_anchor_message_id_key" ON "application_corrections"("anchor_message_id");

-- Carry every correction already made by hand over to the new table before the
-- columns holding them are dropped. The anchor is the oldest message in the
-- application, which is what the correction was made against.
INSERT INTO "application_corrections" ("anchor_message_id", "is_hidden", "status_override", "company_snapshot", "role_snapshot", "created_at", "updated_at")
SELECT
    (SELECT "m"."id" FROM "email_messages" "m"
      WHERE "m"."application_id" = "a"."id"
      ORDER BY "m"."received_at" ASC, "m"."id" ASC LIMIT 1),
    "a"."is_hidden",
    "a"."status_override",
    "a"."company_normalized",
    "a"."role_title",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "applications" "a"
WHERE ("a"."is_hidden" = true OR "a"."status_override" IS NOT NULL)
  AND EXISTS (SELECT 1 FROM "email_messages" "m" WHERE "m"."application_id" = "a"."id");

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN "grouping_version" INTEGER;

-- AlterTable
ALTER TABLE "sync_runs" ADD COLUMN "applications_rebuilt" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sync_runs" ADD COLUMN "notes" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_applications" (
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
    "first_email_at" DATETIME,
    "latest_email_at" DATETIME,
    "ats_vendor" TEXT,
    "confidence" REAL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);
INSERT INTO "new_applications" ("ats_vendor", "company_domain", "company_name", "company_normalized", "confidence", "created_at", "dedupe_key", "first_email_at", "id", "latest_email_at", "role_title", "season", "stage_detail", "status", "updated_at", "year") SELECT "ats_vendor", "company_domain", "company_name", "company_normalized", "confidence", "created_at", "dedupe_key", "first_email_at", "id", "latest_email_at", "role_title", "season", "stage_detail", "status", "updated_at", "year" FROM "applications";
DROP TABLE "applications";
ALTER TABLE "new_applications" RENAME TO "applications";
CREATE UNIQUE INDEX "applications_dedupe_key_key" ON "applications"("dedupe_key");
CREATE INDEX "applications_company_normalized_idx" ON "applications"("company_normalized");
CREATE INDEX "applications_status_idx" ON "applications"("status");
CREATE INDEX "applications_latest_email_at_idx" ON "applications"("latest_email_at");
CREATE INDEX "applications_season_year_idx" ON "applications"("season", "year");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
