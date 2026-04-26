/**
 * requestWorker.js — runs in a worker_threads context.
 *
 * Each worker runs `concurrencyPerWorker` concurrent async request loops.
 * Features:
 *  - Token bucket rate limiter (TPS control)
 *  - Ramp-up: gradually increases TPS from 0 to target over `rampUp` seconds
 *  - Think time: pause between requests per virtual user (simulates real users)
 *  - Step load: responds to 'setTps' message to increase TPS at runtime
 */
const { workerData, parentPort } = require('worker_threads');
const axios = require('axios');
const http = require('http');
const https = require('https');

const { config, tpsPerWorker, concurrencyPerWorker, rampUp = 0 } = workerData;

let running = true;

// ─── HTTP Keep-Alive agents ───────────────────────────────────────────────────
// Reuse TCP connections between requests instead of opening a new one every time.
// This reduces latency by ~50-100ms per request on the first connection
// and significantly lowers CPU/memory usage at high TPS.
// maxSockets = concurrencyPerWorker so we don't open more connections than needed.
const httpAgent  = new http.Agent ({ keepAlive: true, maxSockets: concurrencyPerWorker });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: concurrencyPerWorker });

// ─── Token bucket (rate limiter) ──────────────────────────────────────────────
// Controls how many requests per second this worker sends.
// Uses a "leaky bucket" approach: tokens refill at `rate` per second.
class TokenBucket {
  constructor(rate) {
    this.rate = rate;
    // Capacity must be >= 1 so tokens can accumulate to 1 and trigger a request
    this.capacity = rate > 0 ? Math.max(rate, 1) : Infinity;
    this.tokens = rate > 0 ? Math.min(this.capacity, 5) : Infinity;
    this.lastTime = Date.now();
  }

  // Update token count based on elapsed time
  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastTime) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.rate);
    this.lastTime = now;
  }

  // Wait until a token is available, then consume one
  async consume() {
    if (!this.rate) return; // 0 = unlimited, no waiting

    while (running) {
      this.refill();

      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }

      // Sleep until next token is available
      const waitMs = Math.max(5, Math.ceil(((1 - this.tokens) / this.rate) * 1000));
      await sleep(Math.min(waitMs, 100));
    }
  }

  // Update the rate at runtime (used by step load mode)
  setRate(newRate) {
    this.refill(); // apply accumulated tokens at old rate first
    this.rate = newRate;
    this.capacity = newRate > 0 ? Math.max(newRate, 1) : Infinity;
  }
}

// Create one shared bucket for this worker (all loops share the same TPS budget)
const bucket = new TokenBucket(tpsPerWorker);

// ─── Ramp-up logic ─────────────────────────────────────────────────────────
// If rampUp > 0, gradually increase the bucket rate from 0 to tpsPerWorker
// over `rampUp` seconds. This prevents a sudden spike at test start.
if (rampUp > 0 && tpsPerWorker > 0) {
  bucket.setRate(0.1); // start very slow
  const startTime = Date.now();
  const rampInterval = setInterval(() => {
    if (!running) { clearInterval(rampInterval); return; }
    const elapsed = (Date.now() - startTime) / 1000;
    const progress = Math.min(elapsed / rampUp, 1); // 0 → 1
    const currentRate = Math.max(0.1, tpsPerWorker * progress);
    bucket.setRate(currentRate);
    if (progress >= 1) clearInterval(rampInterval);
  }, 500); // update every 500ms
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── Variable substitution ────────────────────────────────────────────────────
// Replaces template variables in a string before each request.
// This lets you test endpoints that reject duplicate IDs (e.g. POST /orders).
//
// Supported variables:
//   {{random_int}}  → random integer 0–999999
//   {{random_uuid}} → UUID v4 format  (e.g. a3f2c1d4-...)
//   {{timestamp}}   → current Unix timestamp in ms
//
// Example URL:  https://api.example.com/users/{{random_int}}
// Example body: {"orderId":"{{random_uuid}}","createdAt":{{timestamp}}}
function resolveVariables(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/\{\{random_int\}\}/g, () => Math.floor(Math.random() * 1000000))
    .replace(/\{\{random_uuid\}\}/g, () => {
      // Simple UUID v4 without external library
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
    })
    .replace(/\{\{timestamp\}\}/g, () => Date.now());
}

// ─── Response Assertion checker ───────────────────────────────────────────────
// Evaluates a list of assertion rules against a completed response.
// Returns true when ALL assertions pass (or when no assertions are configured).
function checkAssertions(assertions, statusCode, responseBody, responseTime) {
  if (!assertions || !assertions.length) return null; // null = no assertions configured

  let bodyStr = '';
  if (responseBody !== undefined && responseBody !== null) {
    try {
      bodyStr = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    } catch { bodyStr = ''; }
  }

  return assertions.every((a) => {
    switch (a.type) {
      case 'statusCode': {
        const val = Number(a.value);
        switch (a.operator) {
          case 'equals':    return statusCode === val;
          case 'notEquals': return statusCode !== val;
          case 'gte':       return statusCode >= val;
          case 'lte':       return statusCode <= val;
          case 'range': {
            const [min, max] = String(a.value).split('-').map(Number);
            return statusCode >= min && statusCode <= max;
          }
          default: return true;
        }
      }
      case 'bodyContains':    return bodyStr.includes(String(a.value));
      case 'bodyNotContains': return !bodyStr.includes(String(a.value));
      case 'responseTimeBelow': return responseTime < Number(a.value);
      default: return true;
    }
  });
}

// ─── Core request function with retry ─────────────────────────────────────────
// Makes a single HTTP request and sends the result back to the main thread.
// Retries only on network-level errors (not on HTTP 4xx/5xx).
async function makeRequest() {
  const requestId = generateId();
  const maxAttempts = 1 + (config.retries || 0);
  let lastError = null;
  let lastStatus = 0;
  let totalTime = 0;

  // Resolve template variables fresh for every request
  // so each request gets unique values (important for IDs, timestamps)
  const resolvedUrl  = resolveVariables(config.url);
  const resolvedBody = config.body
    ? resolveVariables(typeof config.body === 'string' ? config.body : JSON.stringify(config.body))
    : undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const start = Date.now();
    try {
      const response = await axios({
        url: resolvedUrl,
        method: config.method || 'GET',
        headers: config.headers || {},
        // Only send body for methods that support it
        data: ['POST', 'PUT', 'PATCH'].includes(config.method) ? resolvedBody : undefined,
        timeout: config.timeout || 30000,
        validateStatus: () => true, // don't throw on 4xx/5xx, we handle it ourselves
        maxRedirects: 5,
        // Use keep-alive agents so TCP connections are reused across requests
        httpAgent,
        httpsAgent,
      });

      totalTime = Date.now() - start;
      const success = response.status >= 200 && response.status < 400;

      // Evaluate response assertions (null = no assertions configured)
      const assertionsPassed = checkAssertions(
        config.assertions,
        response.status,
        response.data,
        totalTime,
      );

      parentPort.postMessage({
        type: 'result',
        requestId,
        success,
        statusCode: response.status,
        responseTime: totalTime,
        error: success ? null : `HTTP ${response.status}`,
        timestamp: new Date().toISOString(),
        assertionsPassed,
      });
      return; // done — exit retry loop
    } catch (err) {
      totalTime = Date.now() - start;
      lastError = err.code === 'ECONNABORTED' ? 'Timeout' : (err.code || err.message);
      lastStatus = 0;

      // Only retry on transient network errors, not on application-level failures
      const isRetryable = err.code === 'ECONNRESET' || err.code === 'ECONNABORTED' || err.code === 'ECONNREFUSED';
      if (attempt < maxAttempts - 1 && isRetryable) {
        await sleep(100 * (attempt + 1)); // exponential backoff
        continue;
      }
    }
  }

  // All attempts failed — report the failure
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
// Each virtual user runs this loop continuously:
//   1. Wait for a token (rate control)
//   2. Make a request
//   3. Optionally wait think time (simulates user pause between actions)
async function runnerLoop() {
  while (running) {
    await bucket.consume();  // wait for TPS slot
    if (!running) break;

    await makeRequest();

    // Think time: simulate a real user pausing before the next request
    if (config.thinkTime > 0) {
      await sleep(config.thinkTime);
    }
  }
}

// ─── Start concurrent runner loops ────────────────────────────────────────────
// Each loop = one virtual user. They all share the same token bucket.
const runners = [];
for (let i = 0; i < concurrencyPerWorker; i++) {
  runners.push(runnerLoop().catch((err) => console.error('[Worker] runner error:', err.message)));
}

// ─── Handle messages from main thread ────────────────────────────────────────
parentPort.on('message', (msg) => {
  if (msg.type === 'stop') {
    // Gracefully stop all runner loops
    running = false;
  } else if (msg.type === 'setTps') {
    // Step load: update the token bucket rate at runtime
    bucket.setRate(msg.tps);
  }
});
