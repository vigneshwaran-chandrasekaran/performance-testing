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

  // ─── Test history ──────────────────────────────────────────────────
  // Keep the last 10 completed test results in memory so the frontend
  // can show a history list without a database.
  const testHistory = [];

  // ─── Metrics helpers ───────────────────────────────────────────────

  function createEmptyMetrics() {
    return {
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      responseTimeSum: 0,
      minResponseTime: null,
      maxResponseTime: 0,

      // All individual response times kept in memory for percentile calculation.
      // We cap at 100 000 to avoid unbounded memory growth on long tests.
      responseTimes: [],

      // Error breakdown: maps HTTP status code (or error type) → count
      // e.g. { '500': 12, 'Timeout': 3, '404': 1 }
      errorBreakdown: {},

      // Latency histogram buckets in ms: 0-100, 101-300, 301-500, 501-1000, 1001-3000, 3000+
      histogram: { '0-100': 0, '101-300': 0, '301-500': 0, '501-1000': 0, '1001-3000': 0, '3000+': 0 },

      // Assertion tracking (null = no assertions configured in this test)
      assertionPassCount: 0,
      assertionFailCount: 0,

      recentLogs: [],       // last 200 individual request logs shown in UI table
      allLogs: [],          // full log for CSV/JSON export (capped at 10 000)
      perSecondData: [],    // [{second, tps, avgResponseTime, p95}] for live charts

      // Per-second accumulators (reset every second)
      _secondRequests: 0,
      _secondResponseTimeSum: 0,
      _secondResponseTimes: [], // raw times this second — used to calculate per-second P95
      _secondStart: Date.now(),
    };
  }

  // ─── Percentile helper ─────────────────────────────────────────────
  // Given a sorted array of numbers, return the value at the Nth percentile.
  // e.g. percentile([1,2,3,4,5,6,7,8,9,10], 90) => 9
  function percentile(sortedArr, p) {
    if (!sortedArr.length) return 0;
    const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
    return sortedArr[Math.max(0, idx)];
  }

  // ─── Histogram bucket helper ───────────────────────────────────────
  // Returns the histogram bucket key for a given response time (ms)
  function histogramBucket(ms) {
    if (ms <= 100) return '0-100';
    if (ms <= 300) return '101-300';
    if (ms <= 500) return '301-500';
    if (ms <= 1000) return '501-1000';
    if (ms <= 3000) return '1001-3000';
    return '3000+';
  }

  function handleWorkerResult(msg) {
    if (msg.type !== 'result' || !testState.running) return;

    metrics.totalRequests++;
    if (msg.success) {
      metrics.successCount++;
    } else {
      metrics.failureCount++;

      // Track error by status code or error type for breakdown chart
      // e.g. '500', '404', 'Timeout', 'ECONNREFUSED'
      const errorKey = msg.statusCode ? String(msg.statusCode) : (msg.error || 'Unknown');
      metrics.errorBreakdown[errorKey] = (metrics.errorBreakdown[errorKey] || 0) + 1;
    }

    metrics.responseTimeSum += msg.responseTime;

    // Track min / max
    if (metrics.minResponseTime === null || msg.responseTime < metrics.minResponseTime) {
      metrics.minResponseTime = msg.responseTime;
    }
    if (msg.responseTime > metrics.maxResponseTime) {
      metrics.maxResponseTime = msg.responseTime;
    }

    // Store raw response time for percentile calculation (capped at 100k)
    if (metrics.responseTimes.length < 100000) {
      metrics.responseTimes.push(msg.responseTime);
    }

    // Increment the histogram bucket for this response time
    const bucket = histogramBucket(msg.responseTime);
    metrics.histogram[bucket]++;

    // Per-second counters for the live chart
    metrics._secondRequests++;
    metrics._secondResponseTimeSum += msg.responseTime;
    metrics._secondResponseTimes.push(msg.responseTime);

    // Track assertion results (null means no assertions were configured)
    if (msg.assertionsPassed === true) metrics.assertionPassCount++;
    else if (msg.assertionsPassed === false) metrics.assertionFailCount++;

    const logEntry = {
      id: msg.requestId,
      timestamp: msg.timestamp,
      statusCode: msg.statusCode,
      responseTime: msg.responseTime,
      success: msg.success,
      error: msg.error || null,
      assertionsPassed: msg.assertionsPassed,
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

    // Calculate P95 for just this second (shows latency spikes in real time)
    const sortedSecond = [...metrics._secondResponseTimes].sort((a, b) => a - b);
    const p95Second = percentile(sortedSecond, 95);

    const second = testState.startTime
      ? Math.floor((Date.now() - testState.startTime) / 1000)
      : metrics.perSecondData.length + 1;

    metrics.perSecondData.push({ second, tps, avgResponseTime: avgRt, p95: p95Second });

    // Keep last 120 data points (2 minutes of history)
    if (metrics.perSecondData.length > 120) metrics.perSecondData.shift();

    metrics._secondRequests = 0;
    metrics._secondResponseTimeSum = 0;
    metrics._secondResponseTimes = [];
    metrics._secondStart = Date.now();
  }

  // ─── Snapshot / public API ─────────────────────────────────────────
  // Builds a complete snapshot of the current test state and metrics.
  // Called every second for live emit, and once on test complete.
  function buildSnapshot(includeAllLogs = false) {
    const avgResponseTime = metrics.totalRequests > 0
      ? Math.round(metrics.responseTimeSum / metrics.totalRequests)
      : 0;

    const elapsed = testState.startTime
      ? Math.floor((Date.now() - testState.startTime) / 1000)
      : 0;

    // Sort response times once to calculate all percentiles efficiently
    const sorted = [...metrics.responseTimes].sort((a, b) => a - b);

    const snapshot = {
      testId: testState.testId,
      running: testState.running,
      elapsedSeconds: elapsed,
      // Duration from config so frontend can show progress bar
      totalDuration: testState.config ? testState.config.duration : 0,

      totalRequests: metrics.totalRequests,
      successCount: metrics.successCount,
      failureCount: metrics.failureCount,
      successRate: metrics.totalRequests > 0
        ? parseFloat(((metrics.successCount / metrics.totalRequests) * 100).toFixed(1))
        : 0,

      // Response time stats
      avgResponseTime,
      minResponseTime: metrics.minResponseTime ?? 0,
      maxResponseTime: metrics.maxResponseTime,

      // Percentiles — p50 is median, p95/p99 reveal tail latency
      p50: percentile(sorted, 50),
      p90: percentile(sorted, 90),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),

      // Error breakdown by status code / error type for pie chart
      errorBreakdown: metrics.errorBreakdown,

      // Latency histogram for bar chart
      histogram: metrics.histogram,

      // Assertion results (only meaningful when test has assertions configured)
      assertionPassCount: metrics.assertionPassCount,
      assertionFailCount: metrics.assertionFailCount,
      hasAssertions: !!(testState.config && testState.config.assertions && testState.config.assertions.length > 0),

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
    const {
      concurrency = 10,
      tps = 10,
      duration = 60,
      rampUp = 0,       // seconds to gradually reach full TPS (0 = instant)
      thinkTime = 0,    // ms pause between requests per virtual user
      loadProfile = 'constant', // 'constant' | 'ramp' | 'step'
      stepSize = 0,     // TPS to add every stepInterval seconds (for 'step' mode)
      stepInterval = 10,// seconds between each step increase
      maxErrorRate = 0, // SLA: auto-stop when error % exceeds this (0 = disabled)
      maxP95 = 0,       // SLA: auto-stop when P95 ms exceeds this (0 = disabled)
    } = config;

    // Worker count: capped by CPU count, 16, concurrency, AND tps
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
            thinkTime,   // passed to worker so it pauses after each request
            assertions: config.assertions || [],  // response assertion rules
          },
          tpsPerWorker,
          concurrencyPerWorker,
          rampUp,        // worker uses this to gradually increase its rate
          loadProfile,
        },
      });

      worker.on('message', handleWorkerResult);
      worker.on('error', (err) => console.error(`[Worker ${i}] error:`, err.message));
      worker.on('exit', (code) => {
        if (code !== 0) console.warn(`[Worker ${i}] exited with code ${code}`);
      });

      workers.push(worker);
    }

    // ── Step load mode ─────────────────────────────────────────────
    // Every `stepInterval` seconds, send each worker a message to
    // increase its TPS by (stepSize / numWorkers).
    if (loadProfile === 'step' && stepSize > 0) {
      let stepCount = 0;
      const stepTimer = setInterval(() => {
        if (!testState.running) { clearInterval(stepTimer); return; }
        stepCount++;
        const addedTpsPerWorker = (stepSize * stepCount) / numWorkers;
        workers.forEach((w) => {
          try { w.postMessage({ type: 'setTps', tps: tpsPerWorker + addedTpsPerWorker }); } catch (_) {}
        });
        console.log(`[Service] Step ${stepCount}: TPS increased by ${stepSize} (total ~${tps + stepSize * stepCount})`);
      }, stepInterval * 1000);
    }

    console.log(`[Service] Test ${testId} started: ${numWorkers} workers, ${concurrencyPerWorker} concurrency/worker, ${tpsPerWorker.toFixed(1)} TPS/worker, ${duration}s, profile=${loadProfile}`);

    // Emit metrics every second
    emitInterval = setInterval(() => {
      if (!testState.running) return;
      flushSecondMetrics();
      const snapshot = buildSnapshot();
      io.emit('metrics-update', snapshot);

      // ── SLA check ────────────────────────────────────────────────
      // Auto-stop the test if error rate or P95 latency exceeds the
      // configured threshold. 0 means "disabled" for that threshold.

      // Only check after at least 5 requests so early noise doesn't trigger it
      if (snapshot.totalRequests >= 5) {
        // Check error rate threshold
        if (maxErrorRate > 0 && snapshot.totalRequests > 0) {
          const errorRate = (snapshot.failureCount / snapshot.totalRequests) * 100;
          if (errorRate >= maxErrorRate) {
            io.emit('sla-breach', {
              reason: `Error rate ${errorRate.toFixed(1)}% exceeded SLA threshold of ${maxErrorRate}%`,
              snapshot,
            });
            stopTest();
            return;
          }
        }
        // Check P95 latency threshold
        if (maxP95 > 0 && snapshot.p95 > 0 && snapshot.p95 > maxP95) {
          io.emit('sla-breach', {
            reason: `P95 latency ${snapshot.p95}ms exceeded SLA threshold of ${maxP95}ms`,
            snapshot,
          });
          stopTest();
          return;
        }
      }
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

    // ── Save to history (keep last 10 runs) ───────────────────────
    // Store a summary + the config so the user can review past results
    testHistory.unshift({
      testId: finalSnapshot.testId,
      completedAt: new Date().toISOString(),
      config: testState.config,
      summary: {
        totalRequests: finalSnapshot.totalRequests,
        successCount: finalSnapshot.successCount,
        failureCount: finalSnapshot.failureCount,
        successRate: finalSnapshot.successRate,
        avgResponseTime: finalSnapshot.avgResponseTime,
        p95: finalSnapshot.p95,
        p99: finalSnapshot.p99,
        elapsedSeconds: finalSnapshot.elapsedSeconds,
      },
    });
    if (testHistory.length > 10) testHistory.length = 10;

    io.emit('metrics-update', finalSnapshot);
    io.emit('test-complete', finalSnapshot);
    console.log(`[Service] Test ${testState.testId} complete: ${finalSnapshot.totalRequests} requests, ${finalSnapshot.successCount} success, p95=${finalSnapshot.p95}ms, p99=${finalSnapshot.p99}ms`);

    // ── Webhook notification ──────────────────────────────────────────
    // If the user configured a webhook URL, POST a compact summary to it.
    // Failures are logged but not surfaced to the user (fire-and-forget).
    if (testState.config && testState.config.webhookUrl) {
      const axios = require('axios');
      const webhookPayload = {
        event: 'test-complete',
        testId: finalSnapshot.testId,
        completedAt: new Date().toISOString(),
        config: {
          url: testState.config.url,
          method: testState.config.method,
          duration: testState.config.duration,
          concurrency: testState.config.concurrency,
          tps: testState.config.tps,
        },
        summary: {
          totalRequests: finalSnapshot.totalRequests,
          successCount: finalSnapshot.successCount,
          failureCount: finalSnapshot.failureCount,
          successRate: finalSnapshot.successRate,
          avgResponseTime: finalSnapshot.avgResponseTime,
          p95: finalSnapshot.p95,
          p99: finalSnapshot.p99,
          elapsedSeconds: finalSnapshot.elapsedSeconds,
        },
      };
      axios.post(testState.config.webhookUrl, webhookPayload, { timeout: 5000 })
        .then(() => console.log(`[Service] Webhook sent to ${testState.config.webhookUrl}`))
        .catch((err) => console.error(`[Service] Webhook failed: ${err.message}`));
    }
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
    // Returns last 10 completed test summaries
    getHistory: () => testHistory,
  };
};
