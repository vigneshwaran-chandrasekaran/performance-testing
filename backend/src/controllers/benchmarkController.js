// benchmarkController.js
// Express router that exposes three endpoints:
//   POST /api/benchmark/start  — kick off a benchmark with the given config
//   POST /api/benchmark/stop   — stop the running benchmark early
//   GET  /api/benchmark/status — check whether a benchmark is currently running

const express = require('express');

module.exports = (benchmarkService) => {
  const router = express.Router();

  // ─── POST /api/benchmark/start ───────────────────────────────────────────

  router.post('/start', (req, res) => {
    try {
      const {
        url,
        connections = 10,
        duration = 30,
        method = 'GET',
        headers = {},
        body = null,
        pipelining = 1,
      } = req.body;

      // Validate required fields
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url is required and must be a string' });
      }

      // connections — how many parallel TCP connections to open (like concurrency)
      if (!Number.isInteger(connections) || connections < 1 || connections > 1000) {
        return res.status(400).json({ error: 'connections must be an integer between 1 and 1000' });
      }

      // duration — test length in seconds
      if (!Number.isInteger(duration) || duration < 1 || duration > 300) {
        return res.status(400).json({ error: 'duration must be an integer between 1 and 300 seconds' });
      }

      // method — only standard HTTP verbs allowed
      const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
      const normalizedMethod = String(method).toUpperCase();
      if (!allowedMethods.includes(normalizedMethod)) {
        return res.status(400).json({ error: `method must be one of: ${allowedMethods.join(', ')}` });
      }

      // headers must be a plain object, not an array
      if (typeof headers !== 'object' || Array.isArray(headers)) {
        return res.status(400).json({ error: 'headers must be a JSON object' });
      }

      const result = benchmarkService.startBenchmark({
        url,
        connections,
        duration,
        method: normalizedMethod,
        headers,
        body,
        // Clamp pipelining to 1–10; values above 10 can overload small servers
        pipelining: Math.min(Math.max(1, Number(pipelining) || 1), 10),
      });

      res.json(result);
    } catch (err) {
      // If a benchmark is already running, return 409 Conflict
      if (err.message.includes('already running')) {
        return res.status(409).json({ error: err.message });
      }
      console.error('[Benchmark] start error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── POST /api/benchmark/stop ────────────────────────────────────────────

  router.post('/stop', (_req, res) => {
    benchmarkService.stopBenchmark();
    res.json({ status: 'stopped' });
  });

  // ─── GET /api/benchmark/status ───────────────────────────────────────────

  router.get('/status', (_req, res) => {
    res.json({ running: benchmarkService.isRunning() });
  });

  return router;
};
