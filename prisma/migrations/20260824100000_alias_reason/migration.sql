-- LOOP4 Decision 5. An alias is a standing claim that two names are one
-- employer, believed by every later message and removed by nothing short of a
-- rebuild. Recording which link made it is what lets the claim be checked
-- after the fact rather than only at the moment it is written.
--
-- Nullable, because rows written before this column existed cannot be given a
-- reason honestly. A rebuild clears the table, so they do not survive long.
ALTER TABLE "company_aliases" ADD COLUMN "reason" TEXT;
