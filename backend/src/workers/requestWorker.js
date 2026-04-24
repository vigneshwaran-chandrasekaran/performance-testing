/**
 * requestWorker.js — runs in a worker_threads context.
 *
 * Receives config via workerData and runs `concurrencyPerWorker` async
 * request loops, each rate-limited to `tpsPerWorker` using a token bucket.
 * Results are streamed back to the main thread via parentPort.
 */
const { workerData, parentPort } = require('worker_threads');
const axios = require('axios');

const { config, tpsPerWorker, concurrencyPerWorker } = workerData;

let running = true;

// ─── Token bucket (rate limiter) ──────────────────────────────────────────────
class TokenBucket {
  constructor(rate) {
    this.rate = rate;              // tokens (requests) per second; 0 = unlimited
    // capacity must be >= 1, otherwise tokens can never reach 1 and consume() deadlocks
    this.capacity = rate > 0 ? Math.max(rate, 1) : Infinity;
    this.tokens = rate > 0 ? Math.min(this.capacity, 5) : Infinity; // warm-up burst
    this.lastTime = Date.now();
  }

  async consume() {
    if (!this.rate) return; // unlimited

    while (running) {
      const now = Date.now();
      const elapsed = (now - this.lastTime) / 1000;
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.rate);
      this.lastTime = now;

      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }

      // Calculate wait time until next token
      const waitMs = Math.max(5, Math.ceil(((1 - this.tokens) / this.rate) * 1000));
      await sleep(Math.min(waitMs, 100));
    }
  }
}

const bucket = new TokenBucket(tpsPerWorker);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── Core request function with retry ─────────────────────────────────────────

async function makeRequest() {
  const requestId = generateId();
  const maxAttempts = 1 + (config.retries || 0);
  let lastError = null;
  let lastStatus = 0;
  let totalTime = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const start = Date.now();
    try {
      const response = await axios({
        url: config.url,
        method: config.method || 'GET',
        headers: config.headers || {},
        data: ['POST', 'PUT', 'PATCH'].includes(config.method) ? config.body : undefined,
        timeout: config.timeout || 30000,
        validateStatus: () => true, // never throw on HTTP errors
        maxRedirects: 5,
      });

      totalTime = Date.now() - start;
      const success = response.status >= 200 && response.status < 400;

      parentPort.postMessage({
        type: 'result',
        requestId,
        success,
        statusCode: response.status,
        responseTime: totalTime,
        error: success ? null : `HTTP ${response.status}`,
        timestamp: new Date().toISOString(),
      });
      return; // success — exit retry loop
    } catch (err) {
      totalTime = Date.now() - start;
      lastError = err.code === 'ECONNABORTED' ? 'Timeout' : (err.code || err.message);
      lastStatus = 0;

      // Only retry on connection/timeout errors, not on application errors
      if (attempt < maxAttempts - 1 && (err.code === 'ECONNRESET' || err.code === 'ECONNABORTED' || err.code === 'ECONNREFUSED')) {
        await sleep(100 * (attempt + 1)); // backoff
        continue;
      }
    }
  }

  // All attempts failed
  parentPort.postMessage({
    type: 'result',
    requestId,
    success: false,
    statusCode: lastStatus,
    responseTime: totalTime,
    error: lastError,
    timestamp: new Date().toISOString(),
  });
}

// ─── Runner loop ──────────────────────────────────────────────────────────────

async function runnerLoop() {
  while (running) {
    await bucket.consume();
    if (!running) break;
    await makeRequest();
  }
}

// ─── Start concurrent runner loops ────────────────────────────────────────────

const runners = [];
for (let i = 0; i < concurrencyPerWorker; i++) {
  runners.push(runnerLoop().catch((err) => console.error('[Worker] runner error:', err.message)));
}

// ─── Handle stop signal from main thread ─────────────────────────────────────

parentPort.on('message', (msg) => {
  if (msg.type === 'stop') {
    running = false;
  }
});
