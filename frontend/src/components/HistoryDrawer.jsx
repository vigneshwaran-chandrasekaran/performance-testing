/**
 * HistoryDrawer.jsx
 *
 * Shows a sliding drawer panel with the last 10 completed test runs.
 * Opens when the user clicks the "History" button in LoadTest.jsx.
 *
 * Data is fetched from GET /api/load-test/history each time the drawer opens.
 * The drawer also allows selecting exactly 2 runs and comparing them side-by-side
 * via the CompareModal.
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
  Checkbox,
  Tooltip,
} from 'antd';
import { HistoryOutlined, EyeOutlined, SwapOutlined } from '@ant-design/icons';
import CompareModal from './CompareModal';

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
  const [compareIds, setCompareIds] = useState([]);     // up to 2 testIds selected for comparison
  const [compareOpen, setCompareOpen] = useState(false);

  // ── Fetch history every time the drawer is opened ────────────────────────
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setCompareIds([]); // clear selection when reopening
    // Use BACKEND_URL so this works in production (Vercel → Render).
    // Previously used a relative URL '/api/...' which only works in local dev.
    fetch(`${BACKEND_URL}/api/load-test/history`)
      .then((res) => res.json())
      .then((data) => setHistory(data || []))
      .catch((err) => console.error('[HistoryDrawer] fetch error:', err))
      .finally(() => setLoading(false));
  }, [open]);

  const toggleCompareId = (testId) => {
    setCompareIds((prev) => {
      if (prev.includes(testId)) return prev.filter((id) => id !== testId);
      if (prev.length >= 2) return [prev[1], testId]; // slide window: drop oldest
      return [...prev, testId];
    });
  };

  const compareRunA = compareIds[0] ? history.find((r) => r.testId === compareIds[0]) : null;
  const compareRunB = compareIds[1] ? history.find((r) => r.testId === compareIds[1]) : null;

  // ── Table columns ─────────────────────────────────────────────────────────
  const columns = [
    {
      title: (
        <Tooltip title="Select exactly 2 runs to compare">Compare</Tooltip>
      ),
      key: 'compare',
      width: 70,
      align: 'center',
      render: (_, record) => (
        <Checkbox
          checked={compareIds.includes(record.testId)}
          onChange={() => toggleCompareId(record.testId)}
        />
      ),
    },
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
        width={960}
        bodyStyle={{ padding: 16 }}
        extra={
          compareIds.length === 2 && (
            <Button
              type="primary"
              icon={<SwapOutlined />}
              onClick={() => setCompareOpen(true)}
            >
              Compare Selected
            </Button>
          )
        }
      >
        {compareIds.length > 0 && compareIds.length < 2 && (
          <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
            Select one more run to enable comparison.
          </Text>
        )}
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
            scroll={{ x: 760 }}
            rowClassName={(record) =>
              compareIds.includes(record.testId) ? 'compare-selected-row' : ''
            }
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

      {/* ── Compare Modal ── */}
      <CompareModal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        runA={compareRunA}
        runB={compareRunB}
      />
    </>
  );
}
