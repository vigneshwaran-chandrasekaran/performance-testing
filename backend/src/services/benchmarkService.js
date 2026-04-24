// benchmarkService.js
// Uses the "autocannon" npm package to run quick HTTP benchmarks.
// autocannon fires many concurrent connections and measures latency + throughput.
// Results are streamed to the browser in real-time via Socket.IO.

const autocannon = require('autocannon');

module.exports = (io) => {
  // The active autocannon instance (null when no benchmark is running)
  let currentInstance = null;

  // Simple flag so the controller can reject duplicate starts
  let benchmarkRunning = false;

  // ─── Start a new benchmark ───────────────────────────────────────────────

  function startBenchmark(config) {
    if (benchmarkRunning) {
      throw new Error('A benchmark is already running. Stop it first.');
    }

    const {
      url,
      connections = 10,   // number of concurrent HTTP connections (like "concurrency")
      duration = 30,       // how many seconds to run
      method = 'GET',
      headers = {},
      body = null,
      pipelining = 1,      // HTTP/1.1 pipelining factor; 1 = disabled (normal)
    } = config;

    benchmarkRunning = true;

    // Build the autocannon options object
    const opts = {
      url,
      connections,
      duration,
      method,
      headers,
      pipelining,
      // We handle progress ourselves via Socket.IO, so no console output needed
      renderProgressBar: false,
      renderResultsTable: false,
      renderLatencyTable: false,
    };

    // Only attach body when provided (autocannon ignores null body but let's be explicit)
    if (body) {
      opts.body = body;
    }

    // ── Per-second accumulators ─────────────────────────────────────────
    // autocannon fires a 'tick' event every second; we reset these each tick
    let tickStats = { requests: 0, errors: 0, bytes: 0, responseTimes: [] };
    let elapsed = 0; // counts seconds elapsed

    // Stores every tick point so we can include it in the final results for charts
    const perSecondData = [];

    // ── Launch autocannon ───────────────────────────────────────────────
    // autocannon(opts, callback) returns the running instance immediately
    const instance = autocannon(opts, (err, results) => {
      // This callback fires once when the benchmark finishes (or hits an error)
      benchmarkRunning = false;
      currentInstance = null;

      if (err) {
        io.emit('benchmark-error', { error: err.message });
        return;
      }

      // Build a clean results object and emit to all browser clients
      io.emit('benchmark-complete', {
        latency: {
          min:  results.latency.min,
          max:  results.latency.max,
          mean: Math.round(results.latency.mean * 10) / 10,
          p50:  results.latency.p50,
          p75:  results.latency.p75,
          p90:  results.latency.p90,
          p99:  results.latency.p99,
          // p99.9 — tail latency; key name has a dot so use bracket notation
          p999: results.latency['p99.9'],
        },
        requests: {
          total: results.requests.total,   // total requests sent
          sent:  results.requests.sent,    // total requests sent (same but different counter)
          // mean req/sec averaged over the full duration
          rps: Math.round(results.requests.mean * 10) / 10,
        },
        throughput: {
          // Average bytes received per second over the full duration
          meanBps: Math.round(results.throughput.mean),
          // Total bytes received across the whole test
          total: results.throughput.total,
        },
        errors:   results.errors,          // connection errors
        timeouts: results.timeouts,        // request timeouts
        non2xx:   results.non2xx,          // HTTP 3xx/4xx/5xx responses
        duration: results.duration,        // actual duration in seconds
        perSecondData,                     // array of per-second points for chart
      });
    });

    // Save the instance so stopBenchmark() can call instance.stop()
    currentInstance = instance;

    // ── Track each response for per-second stats ────────────────────────
    // autocannon fires 'response' for every HTTP response it receives
    instance.on('response', (client, statusCode, resBytes, responseTime) => {
      tickStats.requests++;
      tickStats.bytes += resBytes;
      tickStats.responseTimes.push(responseTime);
      // Count any non-2xx or connection-failure as an error for the live chart
      if (statusCode === 0 || statusCode >= 400) {
        tickStats.errors++;
      }
    });

    // ── Emit per-second live updates ────────────────────────────────────
    // autocannon fires 'tick' every second; use it to push live data to browsers
    instance.on('tick', () => {
      elapsed++;

      // Compute average response time for this second from the collected list
      const rtList = tickStats.responseTimes;
      const avgRt = rtList.length
        ? Math.round(rtList.reduce((a, b) => a + b, 0) / rtList.length)
        : 0;

      const point = {
        second:   elapsed,
        rps:      tickStats.requests,   // requests completed this second
        avgRt,                          // avg response time this second (ms)
        errors:   tickStats.errors,     // errors this second
        bytes:    tickStats.bytes,      // bytes received this second
      };

      perSecondData.push(point);

      // Push to all connected browser clients
      io.emit('benchmark-tick', point);

      // Reset accumulators for the next second
      tickStats = { requests: 0, errors: 0, bytes: 0, responseTimes: [] };
    });

    return {
      status: 'started',
      config: { url, connections, duration, method },
    };
  }

  // ─── Stop a running benchmark ────────────────────────────────────────────

  function stopBenchmark() {
    if (currentInstance) {
      // autocannon exposes a .stop() method on the running instance
      currentInstance.stop();
    }
    benchmarkRunning = false;
  }

  // ─── Status check ────────────────────────────────────────────────────────

  function isRunning() {
    return benchmarkRunning;
  }

  return { startBenchmark, stopBenchmark, isRunning };
};
