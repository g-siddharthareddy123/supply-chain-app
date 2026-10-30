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

For a quick local setup without applying Alembic migrations, you can instead
create missing tables directly from the SQLAlchemy models:

```powershell
python -m app.init_db
```

This imports `app.models` to register the tables, then runs
`Base.metadata.create_all()`. It does not update existing tables when models
change. Use Alembic migrations for schema changes and production deployments.

Swagger UI is at `http://127.0.0.1:8000/docs`; health check is `/health`.
Set `API_KEY` to protect all `/api/v1/` routes, then send `X-API-Key`.

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
