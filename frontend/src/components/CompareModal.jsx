/**
 * CompareModal.jsx
 *
 * Side-by-side comparison of two test history runs.
 * Opened from the HistoryDrawer when the user selects exactly 2 tests
 * and clicks "Compare Selected".
 *
 * Color coding:
 *   - Green = better value (lower latency / higher success rate)
 *   - Red   = worse value
 *   - Gray  = same
 */
import { Modal, Row, Col, Card, Statistic, Typography, Tag, Table, Space, Divider } from 'antd';
import {
  TrophyOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from '@ant-design/icons';

const { Text, Title } = Typography;

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmt(val, suffix = '') {
  if (val === undefined || val === null) return '—';
  return `${Number(val).toLocaleString()}${suffix}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

// ─── Compare two numeric values ────────────────────────────────────────────────
// Returns 'better', 'worse', or 'same' for run A compared to run B.
// higherIsBetter=true  → larger A is better (e.g. success rate)
// higherIsBetter=false → smaller A is better (e.g. latency)
function compareVals(a, b, higherIsBetter) {
  if (a === b) return 'same';
  if (higherIsBetter) return a > b ? 'better' : 'worse';
  return a < b ? 'better' : 'worse';
}

function ResultTag({ result }) {
  if (result === 'better') return <Tag color="success" icon={<ArrowUpOutlined />}>Better</Tag>;
  if (result === 'worse')  return <Tag color="error"   icon={<ArrowDownOutlined />}>Worse</Tag>;
  return <Tag color="default">Same</Tag>;
}

// ─── Metric row config ────────────────────────────────────────────────────────

const METRICS = [
  { key: 'totalRequests',   label: 'Total Requests',  suffix: '',    higherIsBetter: true  },
  { key: 'successRate',     label: 'Success Rate',    suffix: '%',   higherIsBetter: true  },
  { key: 'successCount',    label: 'Successes',       suffix: '',    higherIsBetter: true  },
  { key: 'failureCount',    label: 'Failures',        suffix: '',    higherIsBetter: false },
  { key: 'avgResponseTime', label: 'Avg Response',    suffix: ' ms', higherIsBetter: false },
  { key: 'minResponseTime', label: 'Min Response',    suffix: ' ms', higherIsBetter: false },
  { key: 'maxResponseTime', label: 'Max Response',    suffix: ' ms', higherIsBetter: false },
  { key: 'p50',             label: 'P50 Latency',     suffix: ' ms', higherIsBetter: false },
  { key: 'p95',             label: 'P95 Latency',     suffix: ' ms', higherIsBetter: false },
  { key: 'p99',             label: 'P99 Latency',     suffix: ' ms', higherIsBetter: false },
  { key: 'elapsedSeconds',  label: 'Duration',        suffix: ' s',  higherIsBetter: null  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function CompareModal({ open, onClose, runA, runB }) {
  if (!runA || !runB) return null;

  const summaryA = runA.summary || {};
  const summaryB = runB.summary || {};

  // Count how many metrics A wins vs B wins
  let aWins = 0;
  let bWins = 0;
  METRICS.forEach(({ key, higherIsBetter }) => {
    if (higherIsBetter === null) return;
    const result = compareVals(summaryA[key], summaryB[key], higherIsBetter);
    if (result === 'better') aWins++;
    if (result === 'worse')  bWins++;
  });

  const tableData = METRICS.map(({ key, label, suffix, higherIsBetter }) => {
    const vA = summaryA[key];
    const vB = summaryB[key];
    const result = higherIsBetter !== null ? compareVals(vA, vB, higherIsBetter) : 'same';
    return { key, label, vA, vB, suffix, result };
  });

  const columns = [
    {
      title: 'Metric',
      dataIndex: 'label',
      key: 'label',
      width: 160,
      render: (v) => <Text strong style={{ fontSize: 13 }}>{v}</Text>,
    },
    {
      title: (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }}>Run A</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{fmtDate(runA.completedAt)}</Text>
        </Space>
      ),
      dataIndex: 'vA',
      key: 'vA',
      align: 'right',
      width: 130,
      render: (val, record) => {
        const color = record.result === 'better' ? '#52c41a' : record.result === 'worse' ? '#ff4d4f' : undefined;
        return <Text style={{ color, fontWeight: 600 }}>{fmt(val, record.suffix)}</Text>;
      },
    },
    {
      title: (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }}>Run B</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{fmtDate(runB.completedAt)}</Text>
        </Space>
      ),
      dataIndex: 'vB',
      key: 'vB',
      align: 'right',
      width: 130,
      render: (val, record) => {
        const color = record.result === 'worse' ? '#52c41a' : record.result === 'better' ? '#ff4d4f' : undefined;
        return <Text style={{ color, fontWeight: 600 }}>{fmt(val, record.suffix)}</Text>;
      },
    },
    {
      title: 'A vs B',
      dataIndex: 'result',
      key: 'result',
      width: 100,
      align: 'center',
      render: (result) => <ResultTag result={result} />,
    },
  ];

  return (
    <Modal
      title={
        <Space>
          <TrophyOutlined style={{ color: '#faad14' }} />
          <span>Test Run Comparison</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={750}
    >
      {/* ── Winner summary ── */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card
            size="small"
            style={{
              borderColor: aWins > bWins ? '#52c41a' : aWins === bWins ? '#d9d9d9' : '#ff4d4f',
              borderWidth: 2,
              textAlign: 'center',
            }}
          >
            <Title level={5} style={{ margin: 0, color: aWins > bWins ? '#52c41a' : undefined }}>
              {aWins > bWins ? '🏆 Run A wins' : aWins === bWins ? '🤝 Tie' : 'Run A'}
            </Title>
            <Text type="secondary" style={{ fontSize: 11 }}>{fmtDate(runA.completedAt)}</Text>
            <br />
            <Text style={{ fontSize: 13 }} code>{runA.config?.url}</Text>
            <br />
            <Tag color="blue" style={{ marginTop: 4 }}>{aWins} metric{aWins !== 1 ? 's' : ''} better</Tag>
          </Card>
        </Col>
        <Col span={12}>
          <Card
            size="small"
            style={{
              borderColor: bWins > aWins ? '#52c41a' : bWins === aWins ? '#d9d9d9' : '#ff4d4f',
              borderWidth: 2,
              textAlign: 'center',
            }}
          >
            <Title level={5} style={{ margin: 0, color: bWins > aWins ? '#52c41a' : undefined }}>
              {bWins > aWins ? '🏆 Run B wins' : bWins === aWins ? '🤝 Tie' : 'Run B'}
            </Title>
            <Text type="secondary" style={{ fontSize: 11 }}>{fmtDate(runB.completedAt)}</Text>
            <br />
            <Text style={{ fontSize: 13 }} code>{runB.config?.url}</Text>
            <br />
            <Tag color="blue" style={{ marginTop: 4 }}>{bWins} metric{bWins !== 1 ? 's' : ''} better</Tag>
          </Card>
        </Col>
      </Row>

      <Divider style={{ margin: '8px 0 12px' }} />

      {/* ── Metric comparison table ── */}
      <Table
        size="small"
        columns={columns}
        dataSource={tableData}
        pagination={false}
        rowKey="key"
        bordered={false}
      />
    </Modal>
  );
}
