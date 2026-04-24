const { Worker } = require('worker_threads');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

const WORKER_FILE = path.join(__dirname, '../workers/requestWorker.js');

module.exports = (io) => {
  let testState = {
    running: false,
    testId: null,
    config: null,
    startTime: null,
    endTime: null,
  };

  let metrics = createEmptyMetrics();
  let workers = [];
  let emitInterval = null;
  let stopTimeout = null;

  // ─── Metrics helpers ───────────────────────────────────────────────

  function createEmptyMetrics() {
    return {
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      responseTimeSum: 0,
      minResponseTime: null,
      maxResponseTime: 0,
      recentLogs: [],       // last 200 individual request logs
      allLogs: [],          // full log for export (capped at 10 000)
      perSecondData: [],    // [{second, tps, avgResponseTime}] for charts
      _secondRequests: 0,
      _secondResponseTimeSum: 0,
      _secondStart: Date.now(),
    };
  }

  function handleWorkerResult(msg) {
    if (msg.type !== 'result' || !testState.running) return;

    metrics.totalRequests++;
    if (msg.success) metrics.successCount++;
    else metrics.failureCount++;

    metrics.responseTimeSum += msg.responseTime;

    if (metrics.minResponseTime === null || msg.responseTime < metrics.minResponseTime) {
      metrics.minResponseTime = msg.responseTime;
    }
    if (msg.responseTime > metrics.maxResponseTime) {
      metrics.maxResponseTime = msg.responseTime;
    }

    metrics._secondRequests++;
    metrics._secondResponseTimeSum += msg.responseTime;

    const logEntry = {
      id: msg.requestId,
      timestamp: msg.timestamp,
      statusCode: msg.statusCode,
      responseTime: msg.responseTime,
      success: msg.success,
      error: msg.error || null,
    };

    metrics.recentLogs.unshift(logEntry);
    if (metrics.recentLogs.length > 200) metrics.recentLogs.length = 200;

    metrics.allLogs.push(logEntry);
    if (metrics.allLogs.length > 10000) metrics.allLogs.shift();
  }

  function flushSecondMetrics() {
    const elapsed = Math.max(0.001, (Date.now() - metrics._secondStart) / 1000);
    const tps = Math.round(metrics._secondRequests / elapsed);
    const avgRt = metrics._secondRequests > 0
      ? Math.round(metrics._secondResponseTimeSum / metrics._secondRequests)
      : 0;

    const second = testState.startTime
      ? Math.floor((Date.now() - testState.startTime) / 1000)
      : metrics.perSecondData.length + 1;

    metrics.perSecondData.push({ second, tps, avgResponseTime: avgRt });

    // Keep last 120 data points
    if (metrics.perSecondData.length > 120) metrics.perSecondData.shift();

    metrics._secondRequests = 0;
    metrics._secondResponseTimeSum = 0;
    metrics._secondStart = Date.now();
  }

  // ─── Snapshot / public API ─────────────────────────────────────────

  function buildSnapshot(includeAllLogs = false) {
    const avgResponseTime = metrics.totalRequests > 0
      ? Math.round(metrics.responseTimeSum / metrics.totalRequests)
      : 0;

    const elapsed = testState.startTime
      ? Math.floor((Date.now() - testState.startTime) / 1000)
      : 0;

    const snapshot = {
      testId: testState.testId,
      running: testState.running,
      elapsedSeconds: elapsed,
      totalRequests: metrics.totalRequests,
      successCount: metrics.successCount,
      failureCount: metrics.failureCount,
      successRate: metrics.totalRequests > 0
        ? parseFloat(((metrics.successCount / metrics.totalRequests) * 100).toFixed(1))
        : 0,
      avgResponseTime,
      minResponseTime: metrics.minResponseTime ?? 0,
      maxResponseTime: metrics.maxResponseTime,
      perSecondData: metrics.perSecondData,
      recentLogs: metrics.recentLogs.slice(0, 50),
    };

    if (includeAllLogs) {
      snapshot.allLogs = metrics.allLogs;
    }

    return snapshot;
  }

  // ─── Start / Stop ──────────────────────────────────────────────────

  async function startTest(config) {
    if (testState.running) await stopTest();

    const testId = uuidv4();
    metrics = createEmptyMetrics();
    testState = { running: true, testId, config, startTime: Date.now(), endTime: null };

    const numCPUs = os.cpus().length;
    const { concurrency = 10, tps = 10, duration = 60 } = config;

    // Worker count: capped by CPU count, 16, concurrency, AND tps
    // (tps cap ensures tpsPerWorker >= 1, preventing token-bucket deadlock)
    const maxByTps = tps > 0 ? Math.max(1, Math.floor(tps)) : Infinity;
    const numWorkers = Math.min(Math.max(1, numCPUs), 16, concurrency, maxByTps);
    const concurrencyPerWorker = Math.ceil(concurrency / numWorkers);
    const tpsPerWorker = tps > 0 ? tps / numWorkers : 0; // 0 = unlimited

    workers = [];
    for (let i = 0; i < numWorkers; i++) {
      const worker = new Worker(WORKER_FILE, {
        workerData: {
          config: {
            url: config.url,
            method: config.method || 'GET',
            headers: config.headers || {},
            body: config.body || null,
            timeout: config.timeout || 30000,
            retries: config.retries || 0,
          },
          tpsPerWorker,
          concurrencyPerWorker,
        },
      });

      worker.on('message', handleWorkerResult);
      worker.on('error', (err) => console.error(`[Worker ${i}] error:`, err.message));
      worker.on('exit', (code) => {
        if (code !== 0) console.warn(`[Worker ${i}] exited with code ${code}`);
      });

      workers.push(worker);
    }

    console.log(`[Service] Test ${testId} started: ${numWorkers} workers, ${concurrencyPerWorker} concurrency/worker, ${tpsPerWorker.toFixed(1)} TPS/worker, ${duration}s`);

    // Emit metrics every second
    emitInterval = setInterval(() => {
      if (!testState.running) return;
      flushSecondMetrics();
      io.emit('metrics-update', buildSnapshot());
    }, 1000);

    // Auto-stop after duration
    stopTimeout = setTimeout(() => stopTest(), duration * 1000);

    return testId;
  }

  async function stopTest() {
    if (!testState.running) return;

    testState.running = false;
    testState.endTime = Date.now();

    if (emitInterval) { clearInterval(emitInterval); emitInterval = null; }
    if (stopTimeout) { clearTimeout(stopTimeout); stopTimeout = null; }

    // Signal workers to stop gracefully
    workers.forEach((w) => {
      try { w.postMessage({ type: 'stop' }); } catch (_) {}
    });

    // Allow in-flight requests ~500ms to complete, then terminate
    await new Promise((resolve) => setTimeout(resolve, 500));
    await Promise.all(workers.map((w) => w.terminate().catch(() => {})));
    workers = [];

    flushSecondMetrics();
    const finalSnapshot = buildSnapshot();
    io.emit('metrics-update', finalSnapshot);
    io.emit('test-complete', finalSnapshot);
    console.log(`[Service] Test ${testState.testId} complete: ${finalSnapshot.totalRequests} requests, ${finalSnapshot.successCount} success, ${finalSnapshot.avgResponseTime}ms avg`);
  }

  // ─── Public interface ──────────────────────────────────────────────

  return {
    startTest,
    stopTest,
    getStatus: () => ({
      running: testState.running,
      testId: testState.testId,
      elapsedSeconds: testState.startTime
        ? Math.floor((Date.now() - testState.startTime) / 1000)
        : 0,
    }),
    getResults: () => buildSnapshot(true),
  };
};
