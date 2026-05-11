# T-Toys Node Backend

## Setup

```bash
cd backend
npm install
```

## Run

```bash
npm start
```

## Configuration

Use environment variables (recommended):

- `PORT`
- `NODE_ENV`
- `MONGO_CONNECTION_STRING`
- `MONGO_DATABASE`
- `CORS_ALLOWED_ORIGINS` (comma-separated, use `*` for all)

Or copy `config.example.json` to `config.json` and edit locally.

## Endpoints

- `GET /health`
- `GET /api/info`
- `GET /api/mongo/health`
- `POST /app-logs/:appId/log-user-in-app/:pageName`
