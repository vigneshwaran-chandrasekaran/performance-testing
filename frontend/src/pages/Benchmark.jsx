// Benchmark.jsx
// "Quick Benchmark" page powered by autocannon on the backend.
// Unlike the full Load Test, this focuses on raw throughput:
//   - How many requests per second can your server handle?
//   - What are the latency percentiles (p50 / p75 / p90 / p99 / p99.9)?
// Results stream live via Socket.IO as the test runs.

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Card, Form, Input, InputNumber, Select, Button,
  Row, Col, Table, Tag, Statistic, notification,
  Divider, Space, Tooltip,
} from 'antd';
import {
  ThunderboltOutlined, StopOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as ChartTooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { io } from 'socket.io-client';

// Backend URL — comes from the Vite env variable set on Vercel; falls back to localhost for dev
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

// ─── Helper: format bytes to human-readable string ───────────────────────────

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
  return `${bytes} B/s`;
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function Benchmark() {
  const [form] = Form.useForm();

  // Is a benchmark currently running on the backend?
  const [running, setRunning] = useState(false);

  // Per-second data points coming from 'benchmark-tick' Socket.IO events
  const [tickData, setTickData] = useState([]);

  // Final results emitted by 'benchmark-complete' Socket.IO event
  const [results, setResults] = useState(null);

  const [api, contextHolder] = notification.useNotification();
  const socketRef = useRef(null);

  // ─── Socket.IO — listen for live benchmark events ────────────────────────

  useEffect(() => {
    const socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    // 'benchmark-tick' fires every second while the benchmark is running.
    // Each point has: { second, rps, avgRt, errors, bytes }
    socket.on('benchmark-tick', (point) => {
      setTickData((prev) => [...prev, point]);
    });

    // 'benchmark-complete' fires once when autocannon finishes the full duration.
    socket.on('benchmark-complete', (data) => {
      setRunning(false);
      setResults(data);
      api.success({
        message: 'Benchmark Complete!',
        description: `${data.requests.total.toLocaleString()} requests — ${data.requests.rps} req/s average`,
        duration: 4,
      });
    });

    // 'benchmark-error' fires if autocannon encounters a fatal error.
    socket.on('benchmark-error', (data) => {
      setRunning(false);
      api.error({ message: 'Benchmark Error', description: data.error, duration: 6 });
    });

    return () => socket.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Start benchmark ──────────────────────────────────────────────────────

  const handleStart = useCallback(async (values) => {
    // Clear previous results when starting a new run
    setTickData([]);
    setResults(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/benchmark/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      const data = await res.json();

      if (!res.ok) {
        api.error({ message: 'Failed to start benchmark', description: data.error });
        return;
      }

      setRunning(true);
      api.info({
        message: 'Benchmark started',
        description: `Running ${values.connections} connections for ${values.duration}s`,
        duration: 3,
      });
    } catch (err) {
      api.error({ message: 'Network Error', description: err.message });
    }
  }, [api]);

  // ─── Stop benchmark early ─────────────────────────────────────────────────

  const handleStop = useCallback(async () => {
    try {
      await fetch(`${BACKEND_URL}/api/benchmark/stop`, { method: 'POST' });
      setRunning(false);
    } catch (err) {
      api.error({ message: 'Failed to stop benchmark', description: err.message });
    }
  }, [api]);

  // ─── Latency percentile table ─────────────────────────────────────────────

  // Column definitions for the latency results table
  const latencyColumns = [
    {
      title: 'Percentile',
      dataIndex: 'percentile',
      key: 'p',
      width: 140,
    },
    {
      title: 'Latency (ms)',
      dataIndex: 'value',
      key: 'v',
      render: (v) => <strong>{v}</strong>,
    },
    {
      title: '',
      dataIndex: 'note',
      key: 'note',
      render: (note) => note ? <span style={{ color: '#8c8c8c', fontSize: 12 }}>{note}</span> : null,
    },
  ];

  // Build table rows from the final results object
  const latencyData = results ? [
    { key: 'min',  percentile: 'Min',    value: results.latency.min,  note: 'Fastest response' },
    { key: 'mean', percentile: 'Mean',   value: results.latency.mean, note: 'Average' },
    { key: 'p50',  percentile: 'P50',    value: results.latency.p50,  note: '50% of requests were faster' },
    { key: 'p75',  percentile: 'P75',    value: results.latency.p75,  note: '' },
    { key: 'p90',  percentile: 'P90',    value: results.latency.p90,  note: '' },
    { key: 'p99',  percentile: 'P99',    value: results.latency.p99,  note: '99% of requests were faster' },
    { key: 'p999', percentile: 'P99.9',  value: results.latency.p999, note: 'Tail latency' },
    { key: 'max',  percentile: 'Max',    value: results.latency.max,  note: 'Slowest response' },
  ] : [];

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      {contextHolder}

      {/* ── Configuration Card ─────────────────────────────────────── */}
      <Card
        title={
          <Space>
            <ThunderboltOutlined style={{ color: '#1677ff' }} />
            <span>Quick Benchmark</span>
            <Tooltip title="Uses autocannon to fire as many requests as possible and measure raw throughput and latency percentiles.">
              <InfoCircleOutlined style={{ color: '#8c8c8c', fontSize: 14 }} />
            </Tooltip>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ method: 'GET', connections: 10, duration: 30, pipelining: 1 }}
          onFinish={handleStart}
        >
          <Row gutter={16}>
            {/* Target URL */}
            <Col xs={24} sm={12}>
              <Form.Item
                name="url"
                label="Target URL"
                rules={[{ required: true, message: 'URL is required' }]}
              >
                <Input placeholder="https://example.com/api/endpoint" />
              </Form.Item>
            </Col>

            {/* HTTP Method */}
            <Col xs={8} sm={4}>
              <Form.Item name="method" label="Method">
                <Select
                  options={['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => ({
                    value: m,
                    label: m,
                  }))}
                />
              </Form.Item>
            </Col>

            {/* Connections — like "concurrency" — number of parallel TCP connections */}
            <Col xs={8} sm={4}>
              <Form.Item
                name="connections"
                label={
                  <Tooltip title="Number of parallel HTTP connections (like concurrency)">
                    Connections
                  </Tooltip>
                }
              >
                <InputNumber min={1} max={1000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>

            {/* Duration in seconds */}
            <Col xs={8} sm={4}>
              <Form.Item name="duration" label="Duration (s)">
                <InputNumber min={1} max={300} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            {/* Pipelining — send N requests without waiting for each response */}
            <Col xs={8} sm={4}>
              <Form.Item
                name="pipelining"
                label={
                  <Tooltip title="HTTP/1.1 pipelining factor. 1 = no pipelining (recommended for most APIs)">
                    Pipelining
                  </Tooltip>
                }
              >
                <InputNumber min={1} max={10} style={{ width: '100%' }} />
              </Form.Item>
            </Col>

            {/* Optional request body for POST/PUT/PATCH */}
            <Col xs={24} sm={12}>
              <Form.Item
                name="body"
                label="Request Body (optional — for POST/PUT/PATCH)"
              >
                <Input.TextArea
                  rows={2}
                  placeholder='{"key": "value"}'
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                />
              </Form.Item>
            </Col>
          </Row>

          {/* Action buttons */}
          <Space>
            <Button
              type="primary"
              htmlType="submit"
              icon={<ThunderboltOutlined />}
              loading={running}
              disabled={running}
              size="middle"
            >
              {running ? 'Running…' : 'Run Benchmark'}
            </Button>

            {running && (
              <Button danger icon={<StopOutlined />} onClick={handleStop}>
                Stop
              </Button>
            )}
          </Space>
        </Form>
      </Card>

      {/* ── Live chart — shows req/s and avg RT while benchmark is running ── */}
      {tickData.length > 0 && (
        <Card
          title="Live Throughput"
          style={{ marginBottom: 16 }}
          extra={running ? <Tag color="processing">Running</Tag> : <Tag color="success">Done</Tag>}
        >
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={tickData} margin={{ top: 5, right: 20, bottom: 20, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="second"
                label={{ value: 'Second', position: 'insideBottom', offset: -10, fontSize: 12 }}
              />
              <YAxis yAxisId="rps" label={{ value: 'Req/s', angle: -90, position: 'insideLeft', fontSize: 12 }} />
              <YAxis yAxisId="rt" orientation="right" label={{ value: 'Avg RT (ms)', angle: 90, position: 'insideRight', fontSize: 12 }} />
              <ChartTooltip
                formatter={(value, name) => [
                  value,
                  name === 'rps' ? 'Req/s' : name === 'avgRt' ? 'Avg RT (ms)' : 'Errors',
                ]}
              />
              <Legend verticalAlign="top" />
              {/* Blue line — requests per second */}
              <Line yAxisId="rps" type="monotone" dataKey="rps" stroke="#1677ff" dot={false} name="Req/s" strokeWidth={2} />
              {/* Orange line — average response time */}
              <Line yAxisId="rt" type="monotone" dataKey="avgRt" stroke="#fa8c16" dot={false} name="Avg RT (ms)" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* ── Final results — shown after benchmark completes ────────── */}
      {results && (
        <>
          <Divider orientation="left">Benchmark Results</Divider>

          {/* Summary statistics cards */}
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} sm={6}>
              <Card size="small">
                <Statistic
                  title="Total Requests"
                  value={results.requests.total.toLocaleString()}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card size="small">
                <Statistic
                  title="Avg Throughput"
                  value={results.requests.rps}
                  suffix="req/s"
                  valueStyle={{ color: '#1677ff' }}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card size="small">
                <Statistic
                  title="Avg Data Rate"
                  value={formatBytes(results.throughput.meanBps)}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card size="small">
                <Statistic
                  title="Errors + Timeouts"
                  value={results.errors + results.timeouts}
                  valueStyle={{
                    color: results.errors + results.timeouts > 0 ? '#cf1322' : '#3f8600',
                  }}
                />
              </Card>
            </Col>
          </Row>

          {/* Latency percentile breakdown table */}
          <Card
            title="Latency Percentiles"
            extra={
              results.non2xx > 0 && (
                <Tag color="warning">Non-2xx responses: {results.non2xx}</Tag>
              )
            }
          >
            <Table
              dataSource={latencyData}
              columns={latencyColumns}
              pagination={false}
              size="small"
              style={{ maxWidth: 520 }}
            />

            <div style={{ marginTop: 12, color: '#8c8c8c', fontSize: 12 }}>
              Duration: {results.duration}s &nbsp;|&nbsp; Total bytes: {(results.throughput.total / 1024).toFixed(1)} KB
              {results.timeouts > 0 && (
                <Tag color="red" style={{ marginLeft: 12 }}>
                  Timeouts: {results.timeouts}
                </Tag>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
