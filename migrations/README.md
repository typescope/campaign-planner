# Database migrations

`src/db/Schema.jo` describes the current database. It creates missing tables and
indexes on startup, but cannot change tables that already exist. Timestamped SQL
files here upgrade those tables, using the same system as `smart-logistics`.

## Adding a migration

Update `src/db/Schema.jo` to describe the new shape **and** add a file named
`<UTC timestamp>-<description>.sql`, for example
`20260923T120000-product-description.sql`:

```sql
-- Existing products have no description until the owner supplies one.
BEGIN IMMEDIATE;

ALTER TABLE products
  ADD COLUMN description TEXT NOT NULL DEFAULT '';

COMMIT;
```

Use timestamps to the second. Files run in filename order. End each statement
with a semicolon; strings, comments, and trigger bodies may contain semicolons.
The `BEGIN`/`COMMIT` wrappers let you review the file manually against a copy of
an old database. The runner skips these wrappers and commits the SQL together
with its migration record. Other transaction controls are not supported.

`Schema` runs first. Migrations that create tables or indexes must use
`IF NOT EXISTS`. New indexes that depend on a column added by a migration cannot
be created by `Schema` before that column exists on old databases; arrange the
schema initialization and migration together when introducing such a change.

Keep each migration's SQL self-contained. Once a file has been applied, never
edit or rename it: add a new migration to correct it. Changing an applied file
does not rerun it on databases that already recorded its filename.

## Startup and history

Startup creates missing schema objects, applies migrations, then seeds the demo
shop and marks interrupted runs as failed. A database with no tables, including
an existing empty file, is **baselined**: all migration filenames are recorded
without executing their SQL, since `Schema` already creates the current shape.
Changes needed by fresh databases must also be reflected in `Schema` or `Seed`.

An existing database runs each unrecorded `.sql` file. Other files and directories
are ignored, and a missing migrations directory is allowed. There is no initial
SQL migration because the existing shop schema does not need changing.

Inspect the recorded filenames and application times with:

```sh
sqlite3 data/shop.db "SELECT * FROM schema_migrations ORDER BY version"
```

Each file and its history entry share one transaction. If a file fails, its
changes and history entry roll back, later files do not run, and startup stops
with the file path and error. Earlier successful files remain committed. Correct
the unapplied file and restart to retry.
