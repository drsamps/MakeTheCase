# Database Backup (Admin > Backup)

A compressed `mysqldump` of the whole database, taken on demand and kept on the server. Ported from
Quizzer's `routes/admin_backup.py`.

- **Service:** `server/services/databaseBackup.js`
- **Routes:** `server/routes/backups.js`, mounted at `/api/admin/backups`
- **UI:** `components/BackupManager.tsx` (Admin > Backup)
- **Rollover hook:** `backup_first` on `POST /api/courses/:id/rollover` and `POST /api/semesters/:id/rollover`

## What it is, and what it is not

It is a safety net and an undo button for operations that are cheap to run and expensive to undo:
rollover, deleting sections or courses, running a migration.

It is **not disaster recovery**. The files sit on the same disk and machine as the database, and the UI
says so. Keep off-server backups too (`dev/DEPLOYMENT-UBUNTU.md` § 9.4).

A backup covers every table in the database (students, transcripts, evaluations, settings, audit log)
plus routines and triggers. It does **not** include `case_files/` or `logs/`.

## Four load-bearing rules

These are repeated in the header of `databaseBackup.js`. Keep them when changing the module.

1. **The password never appears on the command line.** `mysqldump -p<secret>` is visible in `ps` to every
   user on the box while the dump runs. Credentials go into a temporary option file in `os.tmpdir()`
   (random name, created with `wx` at mode 0600, values quoted and escaped by `cnfEscape()`). Its path
   is passed as the **first** argument, `--defaults-extra-file=<path>`, because mysqldump ignores that
   option anywhere else. The file is deleted in a `finally`.
2. **`backups/` is outside the web-served tree and gitignored.** Production Apache serves only `dist/`,
   and the dev `express.static` also serves only `dist/`. The directory is created at 0700 and each file
   is chmod 0600 (advisory on Windows).
3. **Filenames are matched against a list, never joined into a path.** `listBackups()` enumerates the
   directory; `resolveBackup()` and `deleteBackup()` require the request value to equal a listed name
   before any path is built. `NAME_RE` is a sanity check on the listing, not the security boundary.
   `GET /api/admin/backups/..%2F.env.local` returns 404.
4. **Paths resolve from the module location** (`PROJECT_ROOT`, as in `promptLogger.js`), never from the
   process working directory, which pm2 does not guarantee.

## Details

| Topic | Behaviour |
|---|---|
| Names | `makethecase_YYYY-MM-DD_HHMMSS[_tag].sql.gz` (server local time). Seconds are included because minute-precision names collide. Rollover uses tag `pre-rollover`. |
| Binary | `MYSQLDUMP_PATH` from `.env.local`, else `mysqldump` on `PATH`. A missing binary (`ENOENT`) returns code `mysqldump_missing`. Restart the server after changing `.env.local`. |
| Arguments | `--single-transaction --routines --triggers --no-tablespaces --default-character-set=utf8mb4 <MYSQL_DATABASE>`. `--no-tablespaces` avoids needing the PROCESS privilege (MySQL 8.0.21+). Host and port come from `MYSQL_HOST` / `MYSQL_PORT`, as in `server/db.js`. |
| Streaming | `spawn` → `zlib.createGzip()` → `<name>.part`, via `stream/promises` `pipeline`. Nothing is buffered in memory. On exit code 0 the `.part` is renamed to the final name; otherwise it is deleted and the call fails with `dump_failed` and mysqldump's stderr (its `--` progress lines dropped). |
| Retention | `KEEP_BACKUPS = 10` **per kind**: the newest 10 `pre-rollover` backups and the newest 10 others are kept, counted separately so a run of rollovers can't push out a manual backup. The oldest of each kind are pruned after each successful backup. A prune failure is logged, not fatal. |
| Concurrency | An in-process lock: a second backup while one runs gets **409** `backup_in_progress`. |
| Contents | `GET /contents` reads `information_schema.TABLES` for table names, rows and bytes. InnoDB row counts are **estimates** and are labelled as such. |
| Audit | Create (`backup.create`), download (`backup.download`) and delete (`backup.delete`) write to `audit_log`. Rollover records the backup name in its own audit entry. |

## Routes

All require `verifyToken, requireRole(['admin']), requirePermission('backups')`. Responses use the
usual `{ data, error: { message, code } }` shape.

| Route | Behaviour |
|---|---|
| `GET /api/admin/backups` | `{ backups: [{name, bytes, created, tag}], keep, directory, mysqldump_available }` |
| `GET /api/admin/backups/contents` | Tables with estimated rows and bytes. Defined before `/:name`. |
| `POST /api/admin/backups` | Take a backup, then prune. Returns `{ name, bytes, pruned, backups }`. |
| `GET /api/admin/backups/:name` | Download (`application/gzip`); 404 unless the name is listed. |
| `DELETE /api/admin/backups/:name` | Delete; same list check. |

The UI downloads with `fetch` + the Bearer header → blob → object URL, because a plain link cannot carry
the token.

## Permission

`backups` is a grantable admin permission, in `SUPERUSER_FUNCTIONS` in both `utils/permissions.ts` and
`server/middleware/permissions.js`. Superusers always have it; a superuser grants it to another admin in
Admin > Admins (Additional Permissions → Backups). The admin must sign in again for the new permission to
reach their token. An admin who holds only `backups` still sees the Admin tab.

## "Back up first" in Rollover

The Rollover modal has **Take a database backup first**, checked by default. With `backup_first: true`,
an **execute** (never a preview) calls `createBackup({ tag: 'pre-rollover' })` before the rollover
transaction opens:

- If the backup fails, the rollover is refused and nothing is created, with mysqldump's message.
- Rollover is admin-only, and any admin who rolls over can take this backup (no `backups` permission
  needed). The file stays on the server, and downloading it still requires `backups`.
- The success message names the backup file. If the rollover itself fails after the backup, the error
  names the backup too.

## Deployment

See `dev/DEPLOYMENT-UBUNTU.md` § 3.7:

- install `mysql-client` (or set `MYSQLDUMP_PATH`);
- the MySQL user needs `SELECT, SHOW VIEW, TRIGGER, LOCK TABLES` on the database;
- `backups/` owned by the pm2 user at 0700.

Windows dev: `MYSQLDUMP_PATH=C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe`.

## Restoring (command line only)

There is deliberately no restore button.

```bash
# Take a fresh backup first, so the restore itself can be undone.
gunzip -c backups/makethecase_2026-09-12_210635.sql.gz | mysql -u <user> -p <database>
```

On Windows without `gunzip`, extract with 7-Zip and pipe the `.sql` file into `mysql.exe`. Restart the
server afterwards.
