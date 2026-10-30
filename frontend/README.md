# Supply Chain Control Tower frontend

The React/Vite frontend connects to the existing FastAPI backend. It does not replace or modify the backend.

## Requirements

- Node.js 18 or newer
- The FastAPI backend running locally or reachable over the network

## Install and configure

From the repository root, open PowerShell and run:

```powershell
cd frontend
npm install
Copy-Item .env.example .env
```

By default the frontend expects the API at `http://127.0.0.1:8000`. Adjust `.env` if needed:

```dotenv
VITE_API_BASE_URL=/api/v1
VITE_API_KEY=
VITE_API_PROXY_TARGET=http://127.0.0.1:8000
```

For local development, keep the relative API base URL: Vite proxies `/api/v1` and `/health` to `VITE_API_PROXY_TARGET`, avoiding browser CORS configuration. When the backend has `API_KEY` configured, set the same value in `VITE_API_KEY`. The key is sent only to `/api/v1` calls; the public `/health` check does not include it. Do not commit `.env` or expose a production API key in a public frontend build.

For production, serve the frontend and API on the same origin through a reverse proxy, or set `VITE_API_BASE_URL` to the backend's absolute `/api/v1` URL and configure the backend to allow the frontend origin.

## Start

Start the backend separately from the repository root:

```powershell
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload
```

Then start Vite in `frontend`:

```powershell
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). The backend Swagger docs are available at `http://127.0.0.1:8000/docs`.

## Build

```powershell
npm run build
npm run preview
```

All business data is read from the backend. Dashboard metrics are based on fetched backend responses; the orders list follows the backend's pagination metadata. ATP values are displayed as returned by the backend and are not recalculated in the browser.

## Source structure

- `src/pages/` contains one module per route page; `index.js` exports the pages used by the lazy route loader.
- `src/components/common/`, `src/components/layout/`, `src/components/forms/`, and `src/components/dashboard/` contain reusable UI components.
- `src/api/` remains the single Axios client and API service layer.
- `src/hooks/` contains shared data-loading and toast hooks; `src/utils/` contains shared display formatters.
- `src/styles.css` retains the application-wide design and responsive styles.
