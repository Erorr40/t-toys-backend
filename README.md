# T-Toys Deno Backend

## Run (Deno)

```bash
cd backend
deno task dev
```


## Configuration

Use environment variables (recommended):

- `PORT`
- `NODE_ENV`
- `DB_FILE` (SQLite file path, default: `data/ttoys.db`)
- `CORS_ALLOWED_ORIGINS` (comma-separated, use `*` for all)

## Endpoints

- `GET /health`
- `GET /api/info`
- `GET /api/db/health`
- `GET /api/mongo/health` (alias for db health)
- `POST /app-logs/:appId/log-user-in-app/:pageName`

## Node alternative

If you prefer Node (for Windows/IIS hosting) there's a Node server included: `server.js`.

Node quick run (locally):

```bash
cd backend
npm install
npm start
```

Environment variables:
- `PORT` (default 5099)
- `DB_FILE` (default `./data/ttoys.db`)
- `CORS_ALLOWED_ORIGINS` (comma-separated origins or `*`)
