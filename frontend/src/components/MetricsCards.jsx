import { Row, Col, Card, Statistic, Progress, Badge, Space, Typography } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  SendOutlined,
  DashboardOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

export default function MetricsCards({ metrics }) {
  if (!metrics) return null;

  const {
    totalRequests = 0,
    successCount = 0,
    failureCount = 0,
    avgResponseTime = 0,
    minResponseTime = 0,
    maxResponseTime = 0,
    successRate = 0,
    elapsedSeconds = 0,
    running = false,
    perSecondData = [],
  } = metrics;

  // Current TPS from last data point
  const currentTps = perSecondData.length > 0
    ? perSecondData[perSecondData.length - 1].tps
    : 0;

  const rateColor = successRate >= 95 ? '#52c41a' : successRate >= 80 ? '#fa8c16' : '#ff4d4f';

  return (
    <>
      {/* Status bar */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Badge
          status={running ? 'processing' : 'default'}
          text={
            <Text strong style={{ color: running ? '#1677ff' : '#8c8c8c' }}>
              {running ? `Running — ${elapsedSeconds}s elapsed` : 'Test Complete'}
            </Text>
          }
        />
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {/* Total Requests */}
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ textAlign: 'center', borderTop: '3px solid #1677ff' }}>
            <Statistic
              title={<Space><SendOutlined />Total Requests</Space>}
              value={totalRequests}
              valueStyle={{ color: '#1677ff', fontSize: 28 }}
            />
          </Card>
        </Col>

        {/* Success */}
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ textAlign: 'center', borderTop: '3px solid #52c41a' }}>
            <Statistic
              title={<Space><CheckCircleOutlined />Success</Space>}
              value={successCount}
              valueStyle={{ color: '#52c41a', fontSize: 28 }}
            />
          </Card>
        </Col>

        {/* Failures */}
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ textAlign: 'center', borderTop: '3px solid #ff4d4f' }}>
            <Statistic
              title={<Space><CloseCircleOutlined />Failures</Space>}
              value={failureCount}
              valueStyle={{ color: '#ff4d4f', fontSize: 28 }}
            />
          </Card>
        </Col>

        {/* Avg Response Time */}
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

        {/* Current TPS */}
        <Col xs={12} sm={8} md={4}>
          <Card size="small" style={{ textAlign: 'center', borderTop: '3px solid #fa8c16' }}>
            <Statistic
              title={<Space><ThunderboltOutlined />Current TPS</Space>}
              value={currentTps}
              valueStyle={{ color: '#fa8c16', fontSize: 28 }}
            />
          </Card>
        </Col>

        {/* Success Rate */}
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
    </>
  );
}
