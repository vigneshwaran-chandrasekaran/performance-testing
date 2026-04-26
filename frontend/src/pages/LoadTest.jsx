import { useEffect, useRef, useState, useCallback } from 'react';
import { notification, Divider, Button, Space } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import { io } from 'socket.io-client';
import TestForm from '../components/TestForm';
import MetricsCards from '../components/MetricsCards';
import RealtimeCharts from '../components/RealtimeCharts';
import LogsTable from '../components/LogsTable';
import HistoryDrawer from '../components/HistoryDrawer';
import SavedProfiles from '../components/SavedProfiles';
import EnvironmentsPanel, { applyEnvironment } from '../components/EnvironmentsPanel';

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
  const [historyOpen, setHistoryOpen] = useState(false); // controls HistoryDrawer
  const [activeEnvId, setActiveEnvId] = useState(() => {
    try { return localStorage.getItem('loadtest_active_env') ? Number(localStorage.getItem('loadtest_active_env')) : null; }
    catch { return null; }
  });

  const socketRef = useRef(null);
  const formRef = useRef(null); // shared ref so SavedProfiles can read/set form values
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

    // Fired when an SLA threshold (error rate or P95) is breached.
    // The backend automatically stops the test before emitting this event.
    socket.on('sla-breach', (data) => {
      setIsRunning(false);
      api.warning({
        message: 'SLA Threshold Breached — Test Stopped',
        description: data.reason,
        duration: 10,
      });
    });

    return () => socket.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Actions ────────────────────────────────────────────────────────

  const handleActiveEnvChange = useCallback((envId) => {
    setActiveEnvId(envId);
    try {
      if (envId) localStorage.setItem('loadtest_active_env', String(envId));
      else localStorage.removeItem('loadtest_active_env');
    } catch {}
  }, []);

  const handleStart = useCallback(async (config) => {
    try {
      // Load environments from localStorage and apply active env substitutions
      const envs = (() => { try { return JSON.parse(localStorage.getItem('loadtest_environments') || '[]'); } catch { return []; } })();
      const resolvedConfig = applyEnvironment(config, envs, activeEnvId);

      const res = await fetch(`${BACKEND_URL}/api/load-test/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resolvedConfig),
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
            // Full percentile breakdown so you can analyse tail latency offline
            p50: data.p50,
            p90: data.p90,
            p95: data.p95,
            p99: data.p99,
            elapsedSeconds: data.elapsedSeconds,
          },
          // Response time distribution buckets (useful for histograms in other tools)
          histogram: data.histogram || {},
          // Breakdown of every distinct HTTP status code seen during the test
          errorBreakdown: data.errorBreakdown || {},
          perSecondData: data.perSecondData,
          logs: logData,
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        downloadBlob(blob, `load-test-${data.testId?.slice(0, 8) ?? 'results'}.json`);
      } else if (format === 'csv') {
        // Build a summary header block so the CSV is self-contained
        // (you can open it in Excel and immediately see the key numbers)
        const summaryLines = [
          '# SUMMARY',
          `# Test ID,${data.testId ?? ''}`,
          `# Total Requests,${data.totalRequests ?? 0}`,
          `# Success,${data.successCount ?? 0}`,
          `# Failures,${data.failureCount ?? 0}`,
          `# Success Rate (%),${data.successRate ?? 0}`,
          `# Avg RT (ms),${data.avgResponseTime ?? 0}`,
          `# Min RT (ms),${data.minResponseTime ?? 0}`,
          `# Max RT (ms),${data.maxResponseTime ?? 0}`,
          `# P50 (ms),${data.p50 ?? 0}`,
          `# P90 (ms),${data.p90 ?? 0}`,
          `# P95 (ms),${data.p95 ?? 0}`,
          `# P99 (ms),${data.p99 ?? 0}`,
          `# Duration (s),${data.elapsedSeconds ?? 0}`,
          '#',
          '# REQUEST LOG',
        ].join('\n');
        const csv = summaryLines + '\n' + convertToCSV(logData);
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

      {/* Header row: History button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <Button
          icon={<HistoryOutlined />}
          onClick={() => setHistoryOpen(true)}
        >
          History
        </Button>
      </div>

      {/* Saved profiles strip — lets users load/save test configs */}
      <SavedProfiles formRef={formRef} />

      {/* Environment Variables panel — define {{VAR}} substitutions */}
      <EnvironmentsPanel
        activeEnvId={activeEnvId}
        onActiveEnvChange={handleActiveEnvChange}
      />

      {/* Main test form — formRef allows SavedProfiles to inject values */}
      <TestForm
        onStart={handleStart}
        onStop={handleStop}
        isRunning={isRunning}
        formRef={formRef}
      />

      {metrics && (
        <>
          <Divider style={{ margin: '8px 0 16px' }} />
          {/* Pass connected so MetricsCards shows the live/disconnected badge */}
          <MetricsCards metrics={metrics} connected={connected} />
          {/* Pass metrics so charts can render histogram + error breakdown */}
          <RealtimeCharts chartData={chartData} metrics={metrics} />
          <LogsTable logs={logs} onExport={handleExport} />
        </>
      )}

      {/* History Drawer — slides in from the right */}
      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </div>
  );
}
