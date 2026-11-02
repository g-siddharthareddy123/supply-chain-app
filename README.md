# Supply Chain Order Promising & Inventory Control Tower

A synchronous FastAPI service for product/location catalog, inventory, inbound receipts, customer orders, deterministic available-to-promise allocation, exceptions, shipments, and advisory AI-assisted workflows. It uses SQLAlchemy 2.x and supports MySQL/PyMySQL in deployment and SQLite for isolated tests.

## Local setup

1. Install Python 3.10+ and MySQL 8.
2. Create the database/user (replace the sample password):

   ```sql
   CREATE DATABASE supply_chain CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'supply_user'@'localhost' IDENTIFIED BY 'change-me';
   GRANT ALL PRIVILEGES ON supply_chain.* TO 'supply_user'@'localhost';
   ```
3. Create and activate a virtual environment, install dependencies, and configure the connection:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   Copy-Item .env.example .env
   # Edit DATABASE_URL in .env to match your local MySQL credentials.
   ```
4. Apply migrations, load sample records, and launch the API:

   ```powershell
   alembic upgrade head
   py -m scripts.seed
   uvicorn app.main:app --reload
   ```

### Aiven MySQL configuration

FastAPI and Alembic both use the same parsed `DATABASE_URL` from
`app.config.settings`; Alembic does not independently read process variables.
For the configured Aiven instance, set these values in the repository-root
`.env`:

```dotenv
DATABASE_URL=mysql+pymysql://avnadmin@mysql-38ceb870-siddharthareddyganta-be20.e.aivencloud.com:13853/defaultdb
DATABASE_PASSWORD='enter-your-real-password-here'
AIVEN_CA_CERT=C:\path\to\your\aiven-ca.pem
```

Replace the password locally; do not commit it or paste it into chat. Keeping it
in `DATABASE_PASSWORD` lets SQLAlchemy safely handle characters such as `@`,
`/`, `:`, `?`, and `#` without URL-encoding errors. If you instead include the
password in `DATABASE_URL`, percent-encode its special characters.
Download the CA certificate from the Aiven service's connection/security
settings and point `AIVEN_CA_CERT` at that file. Aiven connections require this
CA and verify both the certificate chain and hostname; missing or mismatched
connection settings fail before connecting.

The process environment overrides `.env`. If PowerShell has an old
`DATABASE_URL` set, remove it for the current terminal before running Alembic
or Uvicorn:

```powershell
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:DATABASE_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:AIVEN_CA_CERT -ErrorAction SilentlyContinue
```

Then from the repository root, run:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
```

Restart FastAPI after migrations. For a deployed backend, set the same three
variables in the backend hosting service's environment configuration; do not
put database credentials in frontend/Vite or browser-visible variables.

### Authentication setup

For local development, set `APP_ENV=development` in the repository-root
`.env` file (the same file as `DATABASE_URL`). FastAPI loads this file relative
to `app/config.py`, regardless of the directory from which Uvicorn is launched.
An `APP_ENV` explicitly set in the process environment takes precedence.
Initial-user creation is disabled when the effective `APP_ENV` is anything
other than `development`.
The business API requires either a valid JWT for an active user or, when
`API_KEY` is configured, a matching `X-API-Key`. `/health` and the JSON login
endpoint are public. Keep the JWT signing secret private and set it in `.env`:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Copy the generated value into `JWT_SECRET_KEY` in `.env`. Configure
`JWT_ALGORITHM` (HS256 by default), `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` (30 by
default), and `CORS_ORIGINS` (comma-separated exact browser origins; local Vite
origins are the defaults). Do not use a production API key in the browser build.

After applying `alembic upgrade head` and configuring `JWT_SECRET_KEY`, create
the first planner account. With no bootstrap variables set, the command prompts
for an email and a hidden password. It creates the account only if it does not
already exist, requires a password of at least 12 characters, and stores only
an Argon2id password hash:

```powershell
python -m scripts.create_user
```

Alternatively, set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` in
the local, git-ignored `.env` before running the command, and clear them after
initialization. Never commit those credentials.

For local development, you can also create an account from the frontend at
`/signup`. This self-service endpoint is enabled only with
`APP_ENV=development`, requires a configured `JWT_SECRET_KEY`, and creates
accounts with the same planner access as other users. It is intentionally
disabled outside development until the application has role-based access
control. No default credentials are provided.

Start FastAPI with `uvicorn app.main:app --reload`, then start the React app
from `frontend` with `npm run dev`. Sign in at `/login`; the JWT is held in
`sessionStorage` for that browser tab and sent as `Authorization: Bearer ...`.
Use **Sign out** to remove the local token. Logout does not revoke a token
already copied elsewhere; it expires according to the configured lifetime.
To inspect an authenticated request, use the browser developer tools Network
tab and confirm its request headers contain `Authorization: Bearer ...`.
The backend continues to accept a configured API key for existing non-browser
clients. API-key authentication is an alternative credential and does not
replace JWT validation for `/api/v1/auth/me`.

After changing `.env`, stop the running Uvicorn process with `Ctrl+C` and
restart it so the new settings are loaded. From the repository root:

```powershell
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload
```

### Resetting development business data

The reset command is restricted to `APP_ENV=development` and a local MySQL
database named `supply_chain` on port `3306`. It also verifies the database's
actual selected schema, requires InnoDB for transactional cleanup, and refuses
to proceed if the database tables differ from the reviewed model set. It
preserves the `users` table and `alembic_version`; all other application tables,
including products and locations, are cleaned. No records are restored or
seeded. From the repository root, preview the exact target, counts, and
foreign-key-safe deletion order:

```powershell
.\.venv\Scripts\python.exe -m scripts.reset_development_data --dry-run
```

Before applying, make a complete backup. The command below prompts for the
MySQL password and writes a SQL dump in the current repository directory;
choose a secure location with enough free space and keep the dump private:

```powershell
$backup = Join-Path $HOME "supply_chain-before-reset.sql"
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe" --single-transaction --routines --triggers --host=localhost --port=3306 --user=YOUR_MYSQL_USER --password --result-file="$backup" supply_chain
Get-Item $backup | Select-Object FullName,Length
```

Stop FastAPI (`Ctrl+C`) to prevent concurrent writes. Replace
`YOUR_MYSQL_USER` with the username in the root `.env` database URL; `--password`
prompts securely rather than putting the password on the command line. Then
apply with the resulting backup path; the script checks for definitions for
every application table and data inserts for tables that currently contain
rows. It prints the target and counts again and requires you to type the exact confirmation
`RESET supply_chain`:

```powershell
.\.venv\Scripts\python.exe -m scripts.reset_development_data --apply --backup-file $backup
```

Without `--apply`, the command is always read-only. Applying also requires the
backup file argument and interactive confirmation. It checks row counts have
not changed since preview, deletes in child-before-parent order inside one
InnoDB transaction, verifies all selected business tables are empty and users
are unchanged before committing. A failure rolls back the deletions. It does
not use `TRUNCATE`, reset auto-increment values, drop tables, alter migrations,
delete user accounts, or insert seed data. If `APP_ENV`, host, port, database
name, schema, table engines, or backup validation do not match, it aborts.

After a successful reset, restart FastAPI using the command in the setup
section, then sign in with your existing account. The frontend Vite proxy and
API URL do not need to change. Add new records in this order: create products
and locations, enter inventory adjustments, add receipts if needed, then
create and confirm customer orders. Do not run `python -m scripts.seed`; it
inserts demo records.

Verify the reset in MySQL with:

```sql
USE supply_chain;
SELECT COUNT(*) AS order_count FROM customer_orders;
SELECT COUNT(*) AS inventory_records, COALESCE(SUM(quantity), 0) AS units_on_hand FROM inventory;
SELECT COUNT(*) AS product_count FROM products;
SELECT COUNT(*) AS location_count FROM locations;
SELECT COUNT(*) AS user_count FROM users;
```

The four business counts should be zero; `user_count` should remain unchanged.
The dashboard derives its totals from the existing orders and inventory APIs,
so it should show zero orders, zero open exceptions, and zero units on hand.
Receipts, shipments, exceptions, AI interactions, and customer messages should
also be empty.

For a quick local setup without applying Alembic migrations, you can instead
create missing tables directly from the SQLAlchemy models:

```powershell
python -m app.init_db
```

This imports `app.models` to register the tables, then runs
`Base.metadata.create_all()`. It does not update existing tables when models
change. Use Alembic migrations for schema changes and production deployments.

Swagger UI is at `http://127.0.0.1:8000/docs`; health check is `/health`.

## Tests

```powershell
pytest -q
```

Tests use an isolated in-memory SQLite database. MySQL row locking is requested with `SELECT ... FOR UPDATE`; SQLite does not provide equivalent row-level concurrency guarantees. Run production concurrency validation against MySQL.

## API areas

All business endpoints are under `/api/v1/`:

- `/products`, `/locations`: catalog CRUD; deletion is rejected when foreign keys refer to the record.
- `/inventory`, `/inventory/adjust`: inventory view and reason-required adjustment.
- `/receipts`: create, list, detail, update, receive, cancel.
- `/orders`: create/list/detail/edit, line operations, confirm/cancel, allocation detail, timeline.
- `/atp/{product_id}/{location_id}` and `/atp/{product_id}?start=...&end=...`: current ATP event projection.
- `/exceptions`: open/resolved exception queue.
- `/planner/...`, `/shipments`: audited expedite/reassignment/promise override and partial shipments.
- `/ai/...`: rule-based proposals, explicit application, saved customer message drafts, advisory exception summaries.
- `/auth/register`, `/auth/login`, `/auth/me`: development-only account registration, JWT session creation, and the authenticated user's safe profile.

## Allocation and promise behavior

Confirmed and fulfilling orders are sorted by HIGH, MED, LOW, then order creation time and order number. For each line, a preferred location is enforced when supplied. Otherwise, a location that can fill the line earliest is preferred; if no location can fill the line, the location with the largest projected supply is chosen, with availability date and location ID tie-breakers. On-hand stock is consumed ahead of future receipt lots at the selected site. The line's promise is the earliest lot date by which the required remaining quantity is projected; partial supply is allocated and the uncovered remainder remains backordered. An absent supply date remains an unknown promise, except a future eligible receipt can provide a tentative latest-arrival estimate.

Allocations reserve supply and do not decrement inventory. Rebuilds release active reservation rows and deterministically create a new active set; consumed/released rows and shipment history are retained. The shipped quantity is excluded from outstanding demand. Receipt receiving is idempotent by status and moves its quantity into on-hand exactly once. Canceled receipts are excluded from projections; received receipts cannot be canceled. A physical reversal must be performed as a separately reasoned inventory adjustment.

Mutations that affect reservations use database transactions and row-level locks where the database supports them. Deployments should run on MySQL and use a single transaction boundary per write. SQLite tests verify functional logic but not concurrent writer safety. Unique constraints and nonnegative checks provide additional protection.

Exceptions are refreshed during allocation rebuilds for backorders and late promises; open records are resolved when the condition disappears. A high-priority shortage is also recorded. Exception types and timestamps are persisted.

## AI safeguards and audit

No external model or paid AI API is called. Planner note parsing is a deliberately narrow deterministic parser: it recognizes an existing receipt code, `delay`/`expedite`, and an ISO `YYYY-MM-DD` date. It does not infer a missing identifier or apply unsupported actions. The proposal is saved as `PROPOSED`; the separate apply endpoint revalidates the receipt and requires a reason. Customer communication output is a stored editable draft; marking it sent only changes local status and never sends email. Exception summaries are based on persisted order-line allocations and remain advisory.

Important inventory, receipt, order, planner, shipment, and applied AI operations write audit entries with reason and timestamp. Use reason text that explains the operational decision.

## Migration notes

`alembic upgrade head` applies the initial metadata-backed migration. Later schema changes should be created as explicit, reviewed Alembic revisions (`alembic revision --autogenerate -m "..."`) and tested against MySQL as well as SQLite.
