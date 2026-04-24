import { Card, Row, Col, Empty } from 'antd';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

const CHART_HEIGHT = 220;

const CustomTooltipTps = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 6, padding: '8px 12px' }}>
      <p style={{ margin: 0, color: '#595959', fontSize: 12 }}>Second: {label}</p>
      <p style={{ margin: 0, color: '#fa8c16', fontWeight: 600 }}>TPS: {payload[0]?.value}</p>
    </div>
  );
};

const CustomTooltipRt = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 6, padding: '8px 12px' }}>
      <p style={{ margin: 0, color: '#595959', fontSize: 12 }}>Second: {label}</p>
      <p style={{ margin: 0, color: '#722ed1', fontWeight: 600 }}>Avg RT: {payload[0]?.value} ms</p>
    </div>
  );
};

export default function RealtimeCharts({ chartData }) {
  const hasData = chartData && chartData.length > 0;

  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
      {/* Requests Per Second */}
      <Col xs={24} lg={12}>
        <Card
          title="Requests / Second"
          size="small"
          bodyStyle={{ padding: '12px 16px' }}
        >
          {hasData ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="second"
                  label={{ value: 'sec', position: 'insideBottomRight', offset: -5, fill: '#aaa', fontSize: 11 }}
                  tick={{ fontSize: 11, fill: '#8c8c8c' }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#8c8c8c' }}
                  allowDecimals={false}
                  width={40}
                />
                <Tooltip content={<CustomTooltipTps />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="tps"
                  name="TPS"
                  stroke="#fa8c16"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Empty description="Waiting for data..." style={{ height: CHART_HEIGHT, display: 'flex', flexDirection: 'column', justifyContent: 'center' }} />
          )}
        </Card>
      </Col>

      {/* Average Response Time */}
      <Col xs={24} lg={12}>
        <Card
          title="Avg Response Time (ms)"
          size="small"
          bodyStyle={{ padding: '12px 16px' }}
        >
          {hasData ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="second"
                  label={{ value: 'sec', position: 'insideBottomRight', offset: -5, fill: '#aaa', fontSize: 11 }}
                  tick={{ fontSize: 11, fill: '#8c8c8c' }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#8c8c8c' }}
                  allowDecimals={false}
                  width={50}
                  unit="ms"
                />
                <Tooltip content={<CustomTooltipRt />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="avgResponseTime"
                  name="Avg RT (ms)"
                  stroke="#722ed1"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Empty description="Waiting for data..." style={{ height: CHART_HEIGHT, display: 'flex', flexDirection: 'column', justifyContent: 'center' }} />
          )}
        </Card>
      </Col>
    </Row>
  );
}
