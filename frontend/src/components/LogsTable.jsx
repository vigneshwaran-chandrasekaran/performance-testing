import { Card, Table, Tag, Space, Button, Tooltip, Typography } from 'antd';
import {
  DownloadOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SafetyOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

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

const COLUMNS = [
  {
    title: '#',
    key: 'index',
    width: 55,
    render: (_, __, index) => (
      <Text type="secondary" style={{ fontSize: 11 }}>{index + 1}</Text>
    ),
  },
  {
    title: 'Timestamp',
    dataIndex: 'timestamp',
    key: 'timestamp',
    width: 180,
    render: (val) => (
      <Text style={{ fontSize: 11, fontFamily: 'monospace' }}>
        {val ? new Date(val).toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 }) : '—'}
      </Text>
    ),
  },
  {
    title: 'Status',
    dataIndex: 'statusCode',
    key: 'statusCode',
    width: 90,
    align: 'center',
    render: (code) => {
      if (!code) return <Tag color="default">—</Tag>;
      const color = code >= 500 ? 'error' : code >= 400 ? 'warning' : code >= 200 ? 'success' : 'default';
      return <Tag color={color}>{code}</Tag>;
    },
  },
  {
    title: 'Response Time',
    dataIndex: 'responseTime',
    key: 'responseTime',
    width: 130,
    align: 'right',
    sorter: (a, b) => a.responseTime - b.responseTime,
    render: (ms) => {
      const color = ms > 2000 ? '#ff4d4f' : ms > 500 ? '#fa8c16' : '#52c41a';
      return <Text style={{ color, fontWeight: 600, fontSize: 13 }}>{ms} ms</Text>;
    },
  },
  {
    title: 'Result',
    dataIndex: 'success',
    key: 'success',
    width: 100,
    align: 'center',
    filters: [
      { text: 'Success', value: true },
      { text: 'Failure', value: false },
    ],
    onFilter: (value, record) => record.success === value,
    render: (success) =>
      success ? (
        <Tag icon={<CheckCircleOutlined />} color="success">Pass</Tag>
      ) : (
        <Tag icon={<CloseCircleOutlined />} color="error">Fail</Tag>
      ),
  },
  {
    title: 'Error',
    dataIndex: 'error',
    key: 'error',
    ellipsis: true,
    render: (err) =>
      err ? (
        <Tooltip title={err}>
          <Text type="danger" style={{ fontSize: 11 }}>{err}</Text>
        </Tooltip>
      ) : (
        <Text type="secondary" style={{ fontSize: 11 }}>—</Text>
      ),
  },
  {
    title: <Tooltip title="Response assertion result (only shown when assertions are configured)"><SafetyOutlined /> Assert</Tooltip>,
    dataIndex: 'assertionsPassed',
    key: 'assertionsPassed',
    width: 80,
    align: 'center',
    render: (val) => {
      if (val === null || val === undefined) return <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
      return val
        ? <Tag color="success" style={{ fontSize: 10 }}>Pass</Tag>
        : <Tag color="error" style={{ fontSize: 10 }}>Fail</Tag>;
    },
  },
];

export default function LogsTable({ logs, onExport }) {
  const handleExportJson = () => onExport?.('json');
  const handleExportCsv = () => onExport?.('csv');

  return (
    <Card
      title={
        <Space>
          <FileTextOutlined />
          <span>Real-Time Request Logs</span>
          <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
            (last {logs?.length ?? 0} requests shown)
          </Text>
        </Space>
      }
      extra={
        <Space>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={handleExportJson}
            disabled={!logs?.length}
          >
            JSON
          </Button>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={handleExportCsv}
            disabled={!logs?.length}
          >
            CSV
          </Button>
        </Space>
      }
      style={{ marginBottom: 24 }}
    >
      <Table
        dataSource={logs || []}
        columns={COLUMNS}
        rowKey={(r) => r.id || Math.random()}
        size="small"
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50'],
          showTotal: (total) => `${total} requests`,
        }}
        scroll={{ x: 700 }}
        rowClassName={(record) => (record.success ? '' : 'row-failure')}
        style={{ fontSize: 12 }}
      />

      <style>{`
        .row-failure td {
          background-color: #fff2f0 !important;
        }
      `}</style>
    </Card>
  );
}
