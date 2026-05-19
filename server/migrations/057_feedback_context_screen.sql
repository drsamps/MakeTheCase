-- Add context_screen for the friendly breadcrumb (e.g. "Instructor Dashboard > Content > Case Files").
-- The raw hash route is still kept in context_route; this column is the
-- human-readable label the admin Inbox shows above it.
ALTER TABLE feedback_submissions
  ADD COLUMN context_screen VARCHAR(255) NULL AFTER context_route;
