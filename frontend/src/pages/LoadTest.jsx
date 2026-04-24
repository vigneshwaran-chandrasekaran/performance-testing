import { useEffect, useRef, useState, useCallback } from 'react';
import { notification, Divider } from 'antd';
import { io } from 'socket.io-client';
import TestForm from '../components/TestForm';
import MetricsCards from '../components/MetricsCards';
import RealtimeCharts from '../components/RealtimeCharts';
import LogsTable from '../components/LogsTable';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function convertToCSV(logs) {
  const headers = ['#', 'timestamp', 'statusCode', 'responseTime_ms', 'success', 'error'];
  const rows = logs.map((log, i) => [
    i + 1,
    log.timestamp ?? '',
    log.statusCode ?? '',
    log.responseTime ?? '',
    log.success ? 'true' : 'false',
    log.error ? `"${String(log.error).replace(/"/g, '""')}"` : '',
  ].join(','));
  return [headers.join(','), ...rows].join('\n');
}

export default function LoadTest() {
  const [isRunning, setIsRunning] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const [logs, setLogs] = useState([]);
  const [chartData, setChartData] = useState([]);
  const [connected, setConnected] = useState(false);

  const socketRef = useRef(null);
  const [api, contextHolder] = notification.useNotification();

  // ─── Socket.IO setup ────────────────────────────────────────────────

  useEffect(() => {
    const socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('connect_error', () => {
      api.error({
        message: 'Connection Error',
        description: `Cannot connect to backend at ${BACKEND_URL}. Ensure the backend is running.`,
        key: 'socket-error',
        duration: 5,
      });
    });

    socket.on('metrics-update', (data) => {
      setMetrics(data);
      setIsRunning(data.running);
      if (data.recentLogs) setLogs(data.recentLogs);
      if (data.perSecondData) setChartData(data.perSecondData);
    });

    socket.on('test-complete', (data) => {
      setIsRunning(false);
      setMetrics(data);
      api.success({
        message: 'Load Test Complete',
        description: `${data.totalRequests.toLocaleString()} requests — ${data.successCount.toLocaleString()} passed, ${data.failureCount.toLocaleString()} failed. Avg: ${data.avgResponseTime}ms`,
        duration: 6,
      });
    });

    return () => socket.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Actions ────────────────────────────────────────────────────────

  const handleStart = useCallback(async (config) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/load-test/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      const data = await res.json();

      if (!res.ok) {
        api.error({ message: 'Failed to start test', description: data.error || 'Unknown error' });
        return;
      }

      setIsRunning(true);
      setMetrics(null);
      setLogs([]);
      setChartData([]);

      api.info({
        message: 'Test Started',
        description: data.message,
        duration: 3,
      });
    } catch (err) {
      api.error({ message: 'Network Error', description: err.message });
    }
  }, [api]);

  const handleStop = useCallback(async () => {
    try {
      await fetch(`${BACKEND_URL}/api/load-test/stop`, { method: 'POST' });
      setIsRunning(false);
    } catch (err) {
      api.error({ message: 'Failed to stop test', description: err.message });
    }
  }, [api]);

  const handleExport = useCallback(async (format) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/load-test/results`);
      if (!res.ok) throw new Error('Failed to fetch results');
      const data = await res.json();
      const logData = data.allLogs || data.recentLogs || [];

      if (format === 'json') {
        const exportData = {
          testId: data.testId,
          summary: {
            totalRequests: data.totalRequests,
            successCount: data.successCount,
            failureCount: data.failureCount,
            successRate: data.successRate,
            avgResponseTime: data.avgResponseTime,
            minResponseTime: data.minResponseTime,
            maxResponseTime: data.maxResponseTime,
            elapsedSeconds: data.elapsedSeconds,
          },
          perSecondData: data.perSecondData,
          logs: logData,
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        downloadBlob(blob, `load-test-${data.testId?.slice(0, 8) ?? 'results'}.json`);
      } else if (format === 'csv') {
        const csv = convertToCSV(logData);
        const blob = new Blob([csv], { type: 'text/csv' });
        downloadBlob(blob, `load-test-${data.testId?.slice(0, 8) ?? 'results'}.csv`);
      }

      api.success({ message: `Exported as ${format.toUpperCase()}`, duration: 2 });
    } catch (err) {
      api.error({ message: 'Export failed', description: err.message });
    }
  }, [api]);

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div>
      {contextHolder}

      <TestForm onStart={handleStart} onStop={handleStop} isRunning={isRunning} />

      {metrics && (
        <>
          <Divider style={{ margin: '8px 0 16px' }} />
          <MetricsCards metrics={metrics} />
          <RealtimeCharts chartData={chartData} />
          <LogsTable logs={logs} onExport={handleExport} />
        </>
      )}
    </div>
  );
}
