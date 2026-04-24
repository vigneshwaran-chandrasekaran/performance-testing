const express = require('express');

module.exports = (loadTestService) => {
  const router = express.Router();

  // POST /api/load-test/start
  router.post('/start', async (req, res) => {
    try {
      const {
        url,
        method = 'GET',
        headers = {},
        body = null,
        concurrency = 10,
        tps = 10,
        duration = 60,
        retries = 0,
        timeout = 30000,
        rampUp = 0,
        thinkTime = 0,
        loadProfile = 'constant',
        stepSize = 0,
        stepInterval = 10,
      } = req.body;

      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url is required and must be a string' });
      }

      const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'];
      const normalizedMethod = String(method).toUpperCase();
      if (!allowedMethods.includes(normalizedMethod)) {
        return res.status(400).json({ error: `method must be one of: ${allowedMethods.join(', ')}` });
      }

      if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5000) {
        return res.status(400).json({ error: 'concurrency must be an integer between 1 and 5000' });
      }

      if (typeof tps !== 'number' || tps < 0 || tps > 10000) {
        return res.status(400).json({ error: 'tps must be a number between 0 and 10000 (0 = unlimited)' });
      }

      if (!Number.isInteger(duration) || duration < 1 || duration > 3600) {
        return res.status(400).json({ error: 'duration must be an integer between 1 and 3600 seconds' });
      }

      if (typeof headers !== 'object' || Array.isArray(headers)) {
        return res.status(400).json({ error: 'headers must be a JSON object' });
      }

      const config = {
        url,
        method: normalizedMethod,
        headers,
        body,
        concurrency,
        tps,
        duration,
        retries: Math.min(Math.max(0, Number(retries) || 0), 3),
        timeout: Math.min(Math.max(1000, Number(timeout) || 30000), 120000),
        rampUp: Math.min(Math.max(0, Number(rampUp) || 0), 300),
        thinkTime: Math.min(Math.max(0, Number(thinkTime) || 0), 60000),
        loadProfile: ['constant', 'ramp', 'step'].includes(loadProfile) ? loadProfile : 'constant',
        stepSize: Math.max(0, Number(stepSize) || 0),
        stepInterval: Math.min(Math.max(1, Number(stepInterval) || 10), 300),
      };

      const testId = await loadTestService.startTest(config);
      res.json({ testId, status: 'started', message: `Test started with ${concurrency} concurrent users, ${tps} TPS for ${duration}s` });
    } catch (err) {
      console.error('[Controller] start error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/load-test/stop
  router.post('/stop', async (_req, res) => {
    try {
      await loadTestService.stopTest();
      res.json({ status: 'stopped' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/load-test/status
  router.get('/status', (_req, res) => {
    res.json(loadTestService.getStatus());
  });

  // GET /api/load-test/results
  router.get('/results', (_req, res) => {
    res.json(loadTestService.getResults());
  });

  // GET /api/load-test/history
  // Returns the last 10 completed test summaries
  router.get('/history', (_req, res) => {
    res.json(loadTestService.getHistory());
  });

  return router;
};
