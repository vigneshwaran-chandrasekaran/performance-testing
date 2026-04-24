import { useState } from 'react';
import {
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Button,
  Space,
  Row,
  Col,
  Typography,
  Tooltip,
  Alert,
} from 'antd';
import {
  PlayCircleOutlined,
  StopOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';

const { TextArea } = Input;
const { Text } = Typography;

const DEFAULT_VALUES = {
  method: 'GET',
  concurrency: 10,
  tps: 10,
  duration: 30,
  retries: 0,
  timeout: 10000,
};

function isValidJson(str) {
  if (!str || str.trim() === '') return true;
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

export default function TestForm({ onStart, onStop, isRunning }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleStart = async () => {
    try {
      const values = await form.validateFields();

      let headers = {};
      let body = null;

      if (values.headers) {
        try {
          headers = JSON.parse(values.headers);
        } catch {
          form.setFields([{ name: 'headers', errors: ['Must be valid JSON'] }]);
          return;
        }
      }

      if (values.body) {
        try {
          body = JSON.parse(values.body);
        } catch {
          form.setFields([{ name: 'body', errors: ['Must be valid JSON'] }]);
          return;
        }
      }

      setLoading(true);
      await onStart({
        url: values.url.trim(),
        method: values.method,
        headers,
        body,
        concurrency: values.concurrency,
        tps: values.tps,
        duration: values.duration,
        retries: values.retries ?? 0,
        timeout: values.timeout ?? 10000,
      });
    } catch {
      // validation errors are shown inline
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      title={
        <Space>
          <PlayCircleOutlined style={{ color: '#1677ff' }} />
          <span>Test Configuration</span>
        </Space>
      }
      style={{ marginBottom: 24 }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={DEFAULT_VALUES}
        disabled={isRunning}
      >
        <Row gutter={16}>
          {/* URL */}
          <Col xs={24} md={16}>
            <Form.Item
              label="API URL"
              name="url"
              rules={[
                { required: true, message: 'URL is required' },
                {
                  validator: (_, val) => {
                    try {
                      new URL(val);
                      return Promise.resolve();
                    } catch {
                      return Promise.reject('Enter a valid URL (e.g. https://api.example.com/endpoint)');
                    }
                  },
                },
              ]}
            >
              <Input
                placeholder="https://api.example.com/endpoint"
                size="large"
                allowClear
              />
            </Form.Item>
          </Col>

          {/* Method */}
          <Col xs={24} md={8}>
            <Form.Item label="HTTP Method" name="method">
              <Select size="large">
                {['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'].map((m) => (
                  <Select.Option key={m} value={m}>
                    <Text code style={{ color: methodColor(m) }}>{m}</Text>
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          {/* Headers */}
          <Col xs={24} md={12}>
            <Form.Item
              label={
                <Space>
                  Headers (JSON)
                  <Tooltip title='Example: {"Authorization":"Bearer token","Content-Type":"application/json"}'>
                    <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                  </Tooltip>
                </Space>
              }
              name="headers"
              rules={[
                {
                  validator: (_, val) =>
                    isValidJson(val)
                      ? Promise.resolve()
                      : Promise.reject('Must be valid JSON object'),
                },
              ]}
            >
              <TextArea
                rows={3}
                placeholder={'{\n  "Authorization": "Bearer <token>"\n}'}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
            </Form.Item>
          </Col>

          {/* Body */}
          <Col xs={24} md={12}>
            <Form.Item
              label={
                <Space>
                  Request Body (JSON)
                  <Tooltip title="Only used for POST / PUT / PATCH requests">
                    <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                  </Tooltip>
                </Space>
              }
              name="body"
              rules={[
                {
                  validator: (_, val) =>
                    isValidJson(val)
                      ? Promise.resolve()
                      : Promise.reject('Must be valid JSON'),
                },
              ]}
            >
              <TextArea
                rows={3}
                placeholder={'{\n  "key": "value"\n}'}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          {/* Concurrency */}
          <Col xs={12} sm={8} md={4}>
            <Form.Item
              label={
                <Space>
                  Concurrency
                  <Tooltip title="Max simultaneous requests in flight">
                    <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                  </Tooltip>
                </Space>
              }
              name="concurrency"
              rules={[{ required: true }]}
            >
              <InputNumber min={1} max={5000} style={{ width: '100%' }} />
            </Form.Item>
          </Col>

          {/* TPS */}
          <Col xs={12} sm={8} md={4}>
            <Form.Item
              label={
                <Space>
                  TPS
                  <Tooltip title="Target transactions per second. Set 0 for unlimited.">
                    <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                  </Tooltip>
                </Space>
              }
              name="tps"
              rules={[{ required: true }]}
            >
              <InputNumber min={0} max={10000} style={{ width: '100%' }} />
            </Form.Item>
          </Col>

          {/* Duration */}
          <Col xs={12} sm={8} md={4}>
            <Form.Item
              label="Duration (sec)"
              name="duration"
              rules={[{ required: true }]}
            >
              <InputNumber min={1} max={3600} style={{ width: '100%' }} />
            </Form.Item>
          </Col>

          {/* Retries */}
          <Col xs={12} sm={8} md={4}>
            <Form.Item
              label={
                <Space>
                  Retries
                  <Tooltip title="Retry count on connection errors (0–3)">
                    <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                  </Tooltip>
                </Space>
              }
              name="retries"
            >
              <InputNumber min={0} max={3} style={{ width: '100%' }} />
            </Form.Item>
          </Col>

          {/* Timeout */}
          <Col xs={12} sm={8} md={4}>
            <Form.Item
              label={
                <Space>
                  Timeout (ms)
                  <Tooltip title="Per-request timeout in milliseconds">
                    <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                  </Tooltip>
                </Space>
              }
              name="timeout"
            >
              <InputNumber min={1000} max={120000} step={1000} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        {isRunning && (
          <Alert
            type="info"
            showIcon
            message="Test is running — form is locked until the test completes or is stopped."
            style={{ marginBottom: 16 }}
          />
        )}

        <Space size="middle">
          <Button
            type="primary"
            size="large"
            icon={<PlayCircleOutlined />}
            onClick={handleStart}
            loading={loading}
            disabled={isRunning}
            style={{ minWidth: 140 }}
          >
            Start Test
          </Button>

          <Button
            danger
            size="large"
            icon={<StopOutlined />}
            onClick={onStop}
            disabled={!isRunning}
            style={{ minWidth: 140 }}
          >
            Stop Test
          </Button>
        </Space>
      </Form>
    </Card>
  );
}

function methodColor(method) {
  const colors = {
    GET: '#52c41a',
    POST: '#1677ff',
    PUT: '#fa8c16',
    DELETE: '#ff4d4f',
    PATCH: '#722ed1',
    HEAD: '#13c2c2',
  };
  return colors[method] || '#595959';
}
