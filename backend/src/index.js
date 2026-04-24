const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Initialize service with socket.io instance
const loadTestService = require('./services/loadTestService')(io);

// Mount controller
const loadTestController = require('./controllers/loadTestController')(loadTestService);
app.use('/api/load-test', loadTestController);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // Send current state immediately on connect
  socket.emit('metrics-update', loadTestService.getResults());

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
});

// Graceful shutdown — force-exit after 2s so Ctrl-C always works
function shutdown(signal) {
  console.log(`[Server] ${signal} received, shutting down...`);
  const forceExit = setTimeout(() => {
    console.log('[Server] Force exit after timeout');
    process.exit(0);
  }, 2000);
  forceExit.unref(); // don't keep event loop alive just for this timer

  loadTestService.stopTest().catch(() => {}).finally(() => {
    httpServer.close(() => process.exit(0));
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
