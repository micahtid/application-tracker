-- LOOP4 Decision 7. An ending is a fact about the application, exactly as a
-- stage is, and gets a field of the same shape.
--
-- `status` keeps its four values and needs no migration. ACCEPTED went on
-- covering an offer extended, an offer accepted, an offer declined and an offer
-- the employer took back; REJECTED went on covering being turned down,
-- withdrawing, and a posting that was cancelled. This says which of them it
-- was, and null says the application has not ended.
ALTER TABLE "applications" ADD COLUMN "outcome" TEXT;
