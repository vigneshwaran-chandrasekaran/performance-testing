import { Card, Row, Col, Empty } from 'antd';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';

const CHART_HEIGHT = 220;

// ─── Custom tooltips ─────────────────────────────────────────────────────────

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

// Colors for each histogram bucket from fast to slow
const HISTOGRAM_COLORS = ['#52c41a', '#95de64', '#ffd666', '#fa8c16', '#ff4d4f', '#a8071a'];

// Colors for error breakdown bars
const ERROR_COLORS = ['#ff4d4f', '#fa8c16', '#fadb14', '#722ed1', '#13c2c2', '#1677ff'];

export default function RealtimeCharts({ chartData, metrics }) {
  const hasData = chartData && chartData.length > 0;

  // ── Convert histogram object → array for Recharts ──────────────────────────
  // e.g. { '0-100': 42, '101-300': 15 } → [{ bucket: '0-100', count: 42 }, ...]
  const histogramData = metrics?.histogram
    ? Object.entries(metrics.histogram).map(([bucket, count]) => ({ bucket, count }))
    : [];
  const hasHistogram = histogramData.some((d) => d.count > 0);

  // ── Convert errorBreakdown object → array for Recharts ───────────────────
  // e.g. { '404': 5, 'Timeout': 2 } → [{ label: '404', count: 5 }, ...]
  const errorData = metrics?.errorBreakdown
    ? Object.entries(metrics.errorBreakdown).map(([label, count]) => ({ label, count }))
    : [];
  const hasErrors = errorData.length > 0;

  return (
    <>
      {/* ── Row 1: TPS line chart + Avg Response Time line chart ── */}
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

      {/* ── Row 2: Response Time Histogram + Error Breakdown ── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {/* Response Time Distribution Histogram */}
        {/* Shows how many requests fell into each latency bucket (e.g. 0-100ms, 101-300ms...) */}
        <Col xs={24} lg={12}>
          <Card
            title="Response Time Distribution"
            size="small"
            bodyStyle={{ padding: '12px 16px' }}
          >
            {hasHistogram ? (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <BarChart data={histogramData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#8c8c8c' }} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#8c8c8c' }}
                    allowDecimals={false}
                    width={50}
                    label={{ value: 'count', angle: -90, position: 'insideLeft', fill: '#aaa', fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(value, name) => [value, 'Requests']}
                    labelFormatter={(label) => `Latency: ${label} ms`}
                  />
                  <Bar dataKey="count" name="Requests" radius={[3, 3, 0, 0]}>
                    {/* Each bucket gets a different color: green (fast) → red (slow) */}
                    {histogramData.map((_, idx) => (
                      <Cell key={idx} fill={HISTOGRAM_COLORS[idx % HISTOGRAM_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty description="No response data yet" style={{ height: CHART_HEIGHT, display: 'flex', flexDirection: 'column', justifyContent: 'center' }} />
            )}
          </Card>
        </Col>

        {/* Error Breakdown */}
        {/* Shows count of failures grouped by HTTP status code or error type */}
        <Col xs={24} lg={12}>
          <Card
            title="Error Breakdown"
            size="small"
            bodyStyle={{ padding: '12px 16px' }}
          >
            {hasErrors ? (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <BarChart data={errorData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#8c8c8c' }} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#8c8c8c' }}
                    allowDecimals={false}
                    width={50}
                    label={{ value: 'count', angle: -90, position: 'insideLeft', fill: '#aaa', fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(value) => [value, 'Errors']}
                    labelFormatter={(label) => `Error: ${label}`}
                  />
                  <Bar dataKey="count" name="Errors" radius={[3, 3, 0, 0]}>
                    {errorData.map((_, idx) => (
                      <Cell key={idx} fill={ERROR_COLORS[idx % ERROR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Empty description="No errors yet 🎉" style={{ height: CHART_HEIGHT, display: 'flex', flexDirection: 'column', justifyContent: 'center' }} />
            )}
          </Card>
        </Col>
      </Row>
    </>
  );
}
