# API Load Tester ⚡

A JMeter-style API load testing tool with a React + Ant Design frontend and a Node.js backend that uses `worker_threads` for true parallel load generation.

## Architecture

```
frontend/   React + Ant Design + Recharts + Socket.IO client (port 3000)
backend/    Node.js + Express + Socket.IO + worker_threads (port 5000)
```

## Quick Start

```bash
# Install all dependencies
npm run install:all

# Run both frontend and backend concurrently
npm run dev
```

Then open http://localhost:3000/load-test

## Features

- **Load generation** via `worker_threads` (one thread per CPU core)
- **Token-bucket TPS control** — precise rate limiting per worker
- **Concurrency control** — configurable max simultaneous requests
- **Real-time updates** via Socket.IO (1s refresh)
- **Live charts** — Requests/sec and Avg Response Time over time
- **Request logs table** — filterable, sortable, last 200 requests
- **Export** results as JSON or CSV
- **Retry logic** — configurable retries on connection errors
- **Auto-stop** after configured duration

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/load-test/start` | Start a load test |
| POST | `/api/load-test/stop` | Stop the running test |
| GET | `/api/load-test/status` | Get current status |
| GET | `/api/load-test/results` | Get full results + all logs |

### Start payload
```json
{
  "url": "https://api.example.com/endpoint",
  "method": "GET",
  "headers": { "Authorization": "Bearer token" },
  "body": { "key": "value" },
  "concurrency": 100,
  "tps": 50,
  "duration": 60,
  "retries": 0,
  "timeout": 10000
}
```

## Configuration

| Field | Default | Description |
|-------|---------|-------------|
| concurrency | 10 | Max simultaneous in-flight requests |
| tps | 10 | Target transactions/sec (0 = unlimited) |
| duration | 30 | Test duration in seconds |
| retries | 0 | Retry count on connection errors (max 3) |
| timeout | 10000 | Per-request timeout in milliseconds |
performance testing
