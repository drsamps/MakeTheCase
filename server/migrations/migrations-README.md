Migrations 28-42



Bootstrap done
- All 45 current files have been marked applied on ceochat_prod_copy. Future migrations added to the folder will be picked up automatically by npm run migrate.

For prod deployment: on the prod DB, run 
npm run migrate -- --mark-applied --only 0
once for everything ≤ 037, then npm run migrate will pick up 038–042 and apply only those. (Or just run --mark-applied
for files you know are applied, then npm run migrate for the rest.)

====

Here's the playbook for production (ceochat):                                                                                                                                                             
	       
Production migration steps (028 → 042)
1. Make sure prod .env.local points at the prod DB
MYSQL_HOST=<prod host>                                                                                                                                                                                    
MYSQL_USER=<prod user>
MYSQL_PASSWORD=<prod password>
MYSQL_DATABASE=ceochat

2. Bootstrap the tracker against existing prod state (one-time, only if prod has never run the new migrate script)

Some of these (028–037 — the original Case Writer migrations) may already be applied in prod. If so, mark everything up through the highest-already-applied file so the runner doesn't re-execute them:   

# Dry-run first to see what it would do
npm run migrate:dry

# If 028–037 are already in prod, mark them applied without running:
node server/scripts/run-pending-migrations.js --mark-applied --only 028
node server/scripts/run-pending-migrations.js --mark-applied --only 029
# ... through 037

Or, if you're confident nothing in 028–042 has been applied yet, skip this step entirely.

3. Apply the pending ones
npm run migrate

You'll see per-file [n/N] 0XX_*.sql … ok (47 ms) lines (green) or FAILED (red). It stops on the first failure.

4. Verify
npm run migrate:dry   # should print "Nothing to apply. Database is up-to-date."

Things to double-check before running on prod

- Back up ceochat first — these touch prompts, add columns to case_writer_projects (publish_protagonist, publish_chat_question, publish_arguments_for, publish_arguments_against, default_model_id), and  
re-seed case_writer.* prompts.
- Confirm which of 028–037 are already applied in prod. If the prod DB never had any Case Writer migrations, all 15 will run cleanly. If some are partially applied, use --mark-applied --only NNN per    
file to record them without re-running. When in doubt: SELECT filename FROM schema_migrations; after the first run, or inspect the case_writer_* tables / prompt rows directly.
- The runner needs mysql2 + dotenv already installed (they are — in package.json).

If you'd rather not use the runner on prod, the equivalent manual fallback is still:
mysql -u <user> -p ceochat < server/migrations/038_case_writer_markdown_outputs.sql
# ... 039 through 042
…but the runner gives you idempotency and progress reporting for free.

-----

recap: You're applying Case Writer DB migrations 028-042 to the production ceochat database. Next: back up ceochat, then run npm run migrate:dry to confirm which files are pending before running npm run   migrate. (disable recaps in /config)
