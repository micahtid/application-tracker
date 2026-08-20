-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN "repeat_of_message_id" INTEGER REFERENCES "email_messages" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "email_messages_repeat_of_message_id_idx" ON "email_messages"("repeat_of_message_id");
