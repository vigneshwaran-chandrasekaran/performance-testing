/**
 * HistoryDrawer.jsx
 *
 * Shows a sliding drawer panel with the last 10 completed test runs.
 * Opens when the user clicks the "History" button in LoadTest.jsx.
 *
 * Data is fetched from GET /api/load-test/history each time the drawer opens.
 */
import { useState, useEffect } from 'react';
import {
  Drawer,
  Table,
  Tag,
  Typography,
  Space,
  Spin,
  Empty,
  Descriptions,
  Modal,
  Button,
} from 'antd';
import { HistoryOutlined, EyeOutlined } from '@ant-design/icons';

const { Text } = Typography;

// Backend URL — must match the env variable set on Vercel; falls back to localhost for dev
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

// Color the success rate: green >= 95%, orange >= 80%, red below
function rateColor(rate) {
  if (rate >= 95) return 'green';
  if (rate >= 80) return 'orange';
  return 'red';
}

export default function HistoryDrawer({ open, onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedRun, setSelectedRun] = useState(null); // for config detail modal

  // ── Fetch history every time the drawer is opened ────────────────────────
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    // Use BACKEND_URL so this works in production (Vercel → Render).
    // Previously used a relative URL '/api/...' which only works in local dev.
    fetch(`${BACKEND_URL}/api/load-test/history`)
      .then((res) => res.json())
      .then((data) => setHistory(data || []))
      .catch((err) => console.error('[HistoryDrawer] fetch error:', err))
      .finally(() => setLoading(false));
  }, [open]);

  // ── Table columns ─────────────────────────────────────────────────────────
  const columns = [
    {
      title: 'Completed',
      dataIndex: 'completedAt',
      key: 'completedAt',
      render: (val) => (
        <Text style={{ fontSize: 12 }}>{new Date(val).toLocaleString()}</Text>
      ),
      width: 160,
    },
    {
      title: 'URL',
      dataIndex: ['config', 'url'],
      key: 'url',
      ellipsis: true,
      render: (url) => (
        <Text code style={{ fontSize: 12 }} title={url}>
          {url}
        </Text>
      ),
    },
    {
      title: 'Requests',
      dataIndex: ['summary', 'totalRequests'],
      key: 'totalRequests',
      width: 90,
      align: 'right',
    },
    {
      title: 'Success Rate',
      dataIndex: ['summary', 'successRate'],
      key: 'successRate',
      width: 110,
      align: 'center',
      render: (rate) => (
        <Tag color={rateColor(rate)}>{Number(rate).toFixed(1)}%</Tag>
      ),
    },
    {
      title: 'Avg RT',
      dataIndex: ['summary', 'avgResponseTime'],
      key: 'avgRT',
      width: 80,
      align: 'right',
      render: (v) => `${v} ms`,
    },
    {
      title: 'P95',
      dataIndex: ['summary', 'p95'],
      key: 'p95',
      width: 70,
      align: 'right',
      render: (v) => `${v} ms`,
    },
    {
      title: 'P99',
      dataIndex: ['summary', 'p99'],
      key: 'p99',
      width: 70,
      align: 'right',
      render: (v) => `${v} ms`,
    },
    {
      title: '',
      key: 'action',
      width: 50,
      render: (_, record) => (
        <Button
          type="text"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => setSelectedRun(record)}
          title="View config"
        />
      ),
    },
  ];

  return (
    <>
      {/* ── Main Drawer ── */}
      <Drawer
        title={
          <Space>
            <HistoryOutlined />
            <span>Test History (last 10 runs)</span>
          </Space>
        }
        open={open}
        onClose={onClose}
        width={900}
        bodyStyle={{ padding: 16 }}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin size="large" />
          </div>
        ) : history.length === 0 ? (
          <Empty description="No completed tests yet. Run a test to see history." />
        ) : (
          <Table
            dataSource={history}
            columns={columns}
            rowKey={(r) => r.testId}
            pagination={false}
            size="small"
            scroll={{ x: 700 }}
          />
        )}
      </Drawer>

      {/* ── Config Detail Modal (opens when user clicks eye icon) ── */}
      <Modal
        title="Test Configuration Details"
        open={!!selectedRun}
        onCancel={() => setSelectedRun(null)}
        footer={null}
        width={600}
      >
        {selectedRun && (
          <>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="URL" span={2}>
                <Text code style={{ wordBreak: 'break-all' }}>{selectedRun.config.url}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Method">{selectedRun.config.method}</Descriptions.Item>
              <Descriptions.Item label="Duration">{selectedRun.config.duration}s</Descriptions.Item>
              <Descriptions.Item label="Concurrency">{selectedRun.config.concurrency}</Descriptions.Item>
              <Descriptions.Item label="TPS">{selectedRun.config.tps}</Descriptions.Item>
              <Descriptions.Item label="Load Profile">{selectedRun.config.loadProfile}</Descriptions.Item>
              <Descriptions.Item label="Ramp-up">{selectedRun.config.rampUp}s</Descriptions.Item>
              <Descriptions.Item label="Think Time">{selectedRun.config.thinkTime}ms</Descriptions.Item>
              <Descriptions.Item label="Retries">{selectedRun.config.retries}</Descriptions.Item>
            </Descriptions>

            <Descriptions bordered size="small" column={2} style={{ marginTop: 16 }}>
              <Descriptions.Item label="Total Requests">{selectedRun.summary.totalRequests}</Descriptions.Item>
              <Descriptions.Item label="Success">{selectedRun.summary.successCount}</Descriptions.Item>
              <Descriptions.Item label="Failures">{selectedRun.summary.failureCount}</Descriptions.Item>
              <Descriptions.Item label="Success Rate">
                <Tag color={rateColor(selectedRun.summary.successRate)}>
                  {Number(selectedRun.summary.successRate).toFixed(1)}%
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Avg RT">{selectedRun.summary.avgResponseTime} ms</Descriptions.Item>
              <Descriptions.Item label="P95">{selectedRun.summary.p95} ms</Descriptions.Item>
              <Descriptions.Item label="P99">{selectedRun.summary.p99} ms</Descriptions.Item>
              <Descriptions.Item label="Elapsed">{selectedRun.summary.elapsedSeconds}s</Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Modal>
    </>
  );
}
