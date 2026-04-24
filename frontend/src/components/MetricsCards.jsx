import { Row, Col, Card, Statistic, Progress, Badge, Space, Typography } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  SendOutlined,
  DashboardOutlined,
  WifiOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

export default function MetricsCards({ metrics, connected }) {
  if (!metrics) return null;

  const {
    totalRequests = 0,
    successCount = 0,
    failureCount = 0,
    avgResponseTime = 0,
    minResponseTime = 0,
    maxResponseTime = 0,
    p50 = 0,
    p90 = 0,
    p95 = 0,
    p99 = 0,
    successRate = 0,
    elapsedSeconds = 0,
    totalDuration = 0,
    running = false,
    perSecondData = [],
  } = metrics;

  // Current TPS from the most recent per-second data point
  const currentTps = perSecondData.length > 0
    ? perSecondData[perSecondData.length - 1].tps
    : 0;

  // Color the success rate: green >= 95%, orange >= 80%, red below
  const rateColor = successRate >= 95 ? '#52c41a' : successRate >= 80 ? '#fa8c16' : '#ff4d4f';

  // Progress percentage for duration bar (0–100%)
  const progressPct = totalDuration > 0
    ? Math.min(100, Math.round((elapsedSeconds / totalDuration) * 100))
    : 0;

  return (
    <>
      {/* ── Status bar: running state + Socket.IO connection ── */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <Badge
          status={running ? 'processing' : 'default'}
          text={
            <Text strong style={{ color: running ? '#1677ff' : '#8c8c8c' }}>
              {running ? `Running — ${elapsedSeconds}s / ${totalDuration}s` : 'Test Complete'}
            </Text>
          }
        />
        {/* Socket.IO connection indicator */}
        <Badge
          status={connected ? 'success' : 'error'}
          text={
            <Text type="secondary" style={{ fontSize: 12 }}>
              <WifiOutlined style={{ marginRight: 4 }} />
              {connected ? 'Live' : 'Disconnected'}
            </Text>
          }
        />
      </div>

      {/* ── Duration progress bar (only shown while running) ── */}
      {running && totalDuration > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Test Progress</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{progressPct}%</Text>
          </div>
          <Progress
            percent={progressPct}
            showInfo={false}
            strokeColor={{ from: '#1677ff', to: '#52c41a' }}
            size={['100%', 8]}
          />
        </div>
      )}

      {/* ── Row 1: Request counts + success rate + TPS ── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ textAlign: 'center', borderTop: '3px solid #1677ff' }}>
            <Statistic
              title={<Space><SendOutlined />Total Requests</Space>}
              value={totalRequests}
              valueStyle={{ color: '#1677ff', fontSize: 28 }}
            />
          </Card>
        </Col>

        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ textAlign: 'center', borderTop: '3px solid #52c41a' }}>
            <Statistic
              title={<Space><CheckCircleOutlined />Success</Space>}
              value={successCount}
              valueStyle={{ color: '#52c41a', fontSize: 28 }}
            />
          </Card>
        </Col>

        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ textAlign: 'center', borderTop: '3px solid #ff4d4f' }}>
            <Statistic
              title={<Space><CloseCircleOutlined />Failures</Space>}
              value={failureCount}
              valueStyle={{ color: '#ff4d4f', fontSize: 28 }}
            />
          </Card>
        </Col>

        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ textAlign: 'center', borderTop: '3px solid #722ed1' }}>
            <Statistic
              title={<Space><ClockCircleOutlined />Avg Response</Space>}
              value={avgResponseTime}
              suffix="ms"
              valueStyle={{ color: '#722ed1', fontSize: 28 }}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>
              min {minResponseTime}ms · max {maxResponseTime}ms
            </Text>
          </Card>
        </Col>

        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ textAlign: 'center', borderTop: '3px solid #fa8c16' }}>
            <Statistic
              title={<Space><ThunderboltOutlined />Current TPS</Space>}
              value={currentTps}
              valueStyle={{ color: '#fa8c16', fontSize: 28 }}
            />
          </Card>
        </Col>

        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ textAlign: 'center', borderTop: `3px solid ${rateColor}` }}>
            <Statistic
              title={<Space><DashboardOutlined />Success Rate</Space>}
              value={successRate}
              suffix="%"
              precision={1}
              valueStyle={{ color: rateColor, fontSize: 28 }}
            />
            <Progress
              percent={successRate}
              showInfo={false}
              strokeColor={rateColor}
              size="small"
              style={{ marginTop: 4 }}
            />
          </Card>
        </Col>
      </Row>

      {/* ── Row 2: Percentile latency cards ── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {[
          { label: 'P50 (Median)', value: p50, color: '#13c2c2' },
          { label: 'P90', value: p90, color: '#1677ff' },
          { label: 'P95', value: p95, color: '#fa8c16' },
          { label: 'P99 (Tail)', value: p99, color: '#ff4d4f' },
        ].map(({ label, value, color }) => (
          <Col xs={12} sm={6} md={6} key={label}>
            <Card size="small" style={{ textAlign: 'center', borderTop: `3px solid ${color}` }}>
              <Statistic
                title={label}
                value={value}
                suffix="ms"
                valueStyle={{ color, fontSize: 24 }}
              />
              <Text type="secondary" style={{ fontSize: 11 }}>response time</Text>
            </Card>
          </Col>
        ))}
      </Row>
    </>
  );
}
