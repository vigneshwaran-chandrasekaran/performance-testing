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
  Divider,
  Collapse,
  message,
} from 'antd';
import {
  PlayCircleOutlined,
  StopOutlined,
  InfoCircleOutlined,
  CodeOutlined,
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
  loadProfile: 'constant',
  rampUp: 0,
  thinkTime: 0,
  stepSize: 10,
  stepInterval: 10,
  maxErrorRate: 0, // SLA: % error rate threshold (0 = disabled)
  maxP95: 0,       // SLA: P95 latency ms threshold (0 = disabled)
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

// ─── cURL Parser ─────────────────────────────────────────────────────────────
// Parses a cURL command string and returns { url, method, headers, body }.
// Handles: -H / --header, -X / --request, --data-raw / --data / -d,
//          -b / --cookie, and all other flags that consume a value,
//          single-quoted and double-quoted values, and line continuations (\).

// Flags that take a value argument but whose values we don't need.
// These must be consumed so their value doesn't get mistaken for the URL.
const SKIP_FLAGS = new Set([
  '-b', '--cookie',          // cookies — common cause of URL mis-detection
  '-u', '--user',            // username:password
  '-A', '--user-agent',      // user agent (already covered by -H)
  '-e', '--referer',         // referer (already covered by -H)
  '-m', '--max-time',        // timeout
  '--connect-timeout',       // connect timeout
  '-x', '--proxy',           // proxy URL
  '-o', '--output',          // output file
  '--cert', '--key',         // TLS cert/key
  '--cacert', '--capath',    // CA cert
  '-F', '--form',            // multipart form (not supported in our tool)
  '--limit-rate',            // rate limit
  '--resolve',               // host resolve override
  '--dns-servers',           // DNS override
]);

function tokenizeCurl(str) {
  // Break the cURL string into an array of tokens, respecting quoted strings.
  // Example: curl 'https://x.com' -H 'foo: bar'  → ['curl','https://x.com','-H','foo: bar']
  const tokens = [];
  let i = 0;
  while (i < str.length) {
    // Skip whitespace between tokens
    while (i < str.length && /\s/.test(str[i])) i++;
    if (i >= str.length) break;

    if (str[i] === "'") {
      // Single-quoted token — read until the closing single quote
      let j = i + 1;
      while (j < str.length && str[j] !== "'") j++;
      tokens.push(str.slice(i + 1, j));
      i = j + 1;
    } else if (str[i] === '"') {
      // Double-quoted token — respect backslash escapes inside
      let j = i + 1;
      while (j < str.length && str[j] !== '"') {
        if (str[j] === '\\') j++; // skip escaped character
        j++;
      }
      tokens.push(str.slice(i + 1, j));
      i = j + 1;
    } else {
      // Unquoted token — read until whitespace
      let j = i;
      while (j < str.length && !/\s/.test(str[j])) j++;
      tokens.push(str.slice(i, j));
      i = j;
    }
  }
  return tokens;
}

function parseCurl(curlStr) {
  // Step 1: Remove line-continuation characters (backslash + newline)
  const normalized = curlStr.replace(/\\\n/g, ' ').trim();

  const tokens = tokenizeCurl(normalized);

  let url = '';
  let method = '';       // will default to GET or POST based on body presence
  const headers = {};
  let body = null;

  let i = 0;
  // Skip the leading 'curl' token
  if (tokens[i] && tokens[i].toLowerCase() === 'curl') i++;

  while (i < tokens.length) {
    const tok = tokens[i];

    if (tok === '-X' || tok === '--request') {
      // Explicit method: -X POST
      method = (tokens[++i] || '').toUpperCase();

    } else if (tok === '-H' || tok === '--header') {
      // Header: -H 'Content-Type: application/json'
      const raw = tokens[++i] || '';
      const colonIdx = raw.indexOf(':');
      if (colonIdx > 0) {
        const key   = raw.slice(0, colonIdx).trim();
        const value = raw.slice(colonIdx + 1).trim();
        headers[key] = value;
      }

    } else if (
      tok === '--data-raw' ||
      tok === '--data'     ||
      tok === '--data-binary' ||
      tok === '-d'
    ) {
      // Request body — implies POST if method not already set
      body = tokens[++i] || null;
      if (!method) method = 'POST';

    } else if (SKIP_FLAGS.has(tok)) {
      // These flags take a value we don't need — skip the value token so it
      // doesn't get mistaken for the URL. Example: -b 'cookie=abc' → skip 'cookie=abc'
      i++;

    } else if (!tok.startsWith('-')) {
      // Positional argument without a flag → this is the URL
      // Strip any surrounding quotes that weren't caught by the tokenizer
      url = tok.replace(/^["']|["']$/g, '');
    }

    i++;
  }

  // Default method
  if (!method) method = body ? 'POST' : 'GET';

  return { url, method, headers, body };
}

export default function TestForm({ onStart, onStop, isRunning, initialValues, formRef }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [curlInput, setCurlInput] = useState('');        // raw cURL text in the textarea
  const [curlPanelOpen, setCurlPanelOpen] = useState([]); // controls collapse open/closed
  // Watch loadProfile to show/hide conditional fields
  const loadProfile = Form.useWatch('loadProfile', form);

  // Allow parent components (e.g. SavedProfiles) to set form values
  if (formRef) formRef.current = form;

  // ─── cURL import handler ────────────────────────────────────────────
  // Parses the pasted cURL and populates the form fields automatically.
  const handleParseCurl = () => {
    if (!curlInput.trim()) {
      message.warning('Paste a cURL command first');
      return;
    }
    try {
      const { url, method, headers, body } = parseCurl(curlInput);

      if (!url) {
        message.error('Could not find a URL in the cURL command');
        return;
      }

      // Convert headers object → pretty-printed JSON string for the textarea
      const headersJson = Object.keys(headers).length > 0
        ? JSON.stringify(headers, null, 2)
        : '';

      // If body is valid JSON, pretty-print it; otherwise keep as-is
      let bodyStr = '';
      if (body) {
        try {
          bodyStr = JSON.stringify(JSON.parse(body), null, 2);
        } catch {
          bodyStr = body; // not JSON — leave as plain string
        }
      }

      // Fill all the matching form fields at once
      form.setFieldsValue({
        url,
        method,
        headers: headersJson,
        body: bodyStr,
      });

      // Collapse the import panel so the user sees the filled form
      setCurlPanelOpen([]);
      message.success('cURL imported — review the fields below and click Start Test');
    } catch (err) {
      message.error(`Failed to parse cURL: ${err.message}`);
    }
  };

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
        // New load profile fields
        loadProfile: values.loadProfile ?? 'constant',
        rampUp: values.rampUp ?? 0,
        thinkTime: values.thinkTime ?? 0,
        stepSize: values.stepSize ?? 0,
        stepInterval: values.stepInterval ?? 10,
        // SLA auto-stop thresholds (0 = disabled)
        maxErrorRate: values.maxErrorRate ?? 0,
        maxP95: values.maxP95 ?? 0,
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
        initialValues={{ ...DEFAULT_VALUES, ...initialValues }}
        disabled={isRunning}
      >
        {/* ─── cURL Import ─────────────────────────────────────────────────────
            Paste any cURL command here and click "Parse & Fill" to auto-fill
            the URL, method, headers, and body fields below.
        ──────────────────────────────────────────────────────────────────────── */}
        <Collapse
          activeKey={curlPanelOpen}
          onChange={setCurlPanelOpen}
          ghost
          style={{ marginBottom: 16, border: '1px dashed #d9d9d9', borderRadius: 8 }}
          items={[{
            key: 'curl',
            label: (
              <Space>
                <CodeOutlined style={{ color: '#1677ff' }} />
                <span style={{ fontWeight: 500 }}>Import from cURL</span>
                <span style={{ color: '#8c8c8c', fontSize: 12, fontWeight: 400 }}>
                  — paste a cURL command to auto-fill the form
                </span>
              </Space>
            ),
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                <TextArea
                  rows={6}
                  value={curlInput}
                  onChange={(e) => setCurlInput(e.target.value)}
                  placeholder={`curl 'https://api.example.com/endpoint' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw '{"key":"value"}'`}
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                  allowClear
                />
                <Space>
                  <Button
                    type="primary"
                    icon={<CodeOutlined />}
                    onClick={handleParseCurl}
                    disabled={isRunning}
                  >
                    Parse &amp; Fill Form
                  </Button>
                  <Button onClick={() => setCurlInput('')} disabled={isRunning}>
                    Clear
                  </Button>
                </Space>
              </Space>
            ),
          }]}
        />

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

        {/* ── Advanced: Load Profile settings ── */}
        <Divider orientation="left" orientationMargin={0} style={{ fontSize: 13 }}>
          Load Profile
        </Divider>
        <Row gutter={16}>
          {/* Load Profile selector */}
          <Col xs={24} sm={8} md={6}>
            <Form.Item
              label={
                <Space>
                  Profile
                  <Tooltip title="Constant: fixed TPS throughout | Ramp-up: gradually increase TPS | Step: increase TPS in steps">
                    <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                  </Tooltip>
                </Space>
              }
              name="loadProfile"
            >
              <Select>
                <Select.Option value="constant">Constant</Select.Option>
                <Select.Option value="ramp">Ramp-up</Select.Option>
                <Select.Option value="step">Step Load</Select.Option>
              </Select>
            </Form.Item>
          </Col>

          {/* Think Time: shown for all profiles */}
          <Col xs={12} sm={8} md={5}>
            <Form.Item
              label={
                <Space>
                  Think Time (ms)
                  <Tooltip title="Pause between requests per virtual user (simulates real user behavior). 0 = no pause.">
                    <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                  </Tooltip>
                </Space>
              }
              name="thinkTime"
            >
              <InputNumber min={0} max={60000} step={100} style={{ width: '100%' }} />
            </Form.Item>
          </Col>

          {/* Ramp-up Duration: only shown when profile = 'ramp' */}
          {loadProfile === 'ramp' && (
            <Col xs={12} sm={8} md={5}>
              <Form.Item
                label={
                  <Space>
                    Ramp-up (sec)
                    <Tooltip title="Time to gradually increase from 0 to target TPS">
                      <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                    </Tooltip>
                  </Space>
                }
                name="rampUp"
              >
                <InputNumber min={0} max={300} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          )}

          {/* Step Size + Step Interval: only shown when profile = 'step' */}
          {loadProfile === 'step' && (
            <>
              <Col xs={12} sm={8} md={5}>
                <Form.Item
                  label={
                    <Space>
                      Step Size (TPS)
                      <Tooltip title="Amount to increase TPS at each step">
                        <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                      </Tooltip>
                    </Space>
                  }
                  name="stepSize"
                >
                  <InputNumber min={1} max={1000} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={12} sm={8} md={5}>
                <Form.Item
                  label={
                    <Space>
                      Step Interval (sec)
                      <Tooltip title="How often to increase the TPS (in seconds)">
                        <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                      </Tooltip>
                    </Space>
                  }
                  name="stepInterval"
                >
                  <InputNumber min={1} max={300} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </>
          )}
        </Row>

        {/* ─── SLA Thresholds ─────────────────────────────────────────────────
            Auto-stop the test when error rate OR P95 latency exceeds the limit.
            Set a field to 0 (default) to disable that threshold.
        ──────────────────────────────────────────────────────────────────────── */}
        <Divider orientation="left" style={{ fontSize: 13, color: '#595959', marginTop: 8 }}>
          SLA Thresholds (auto-stop on breach)
        </Divider>
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item
              label="Max Error Rate (%)"
              name="maxErrorRate"
              tooltip="Stop the test automatically if the error rate reaches this %. Set to 0 to disable."
            >
              <InputNumber min={0} max={100} step={1} style={{ width: '100%' }} placeholder="0 = disabled" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              label="Max P95 Latency (ms)"
              name="maxP95"
              tooltip="Stop the test automatically if P95 response time exceeds this value. Set to 0 to disable."
            >
              <InputNumber min={0} max={60000} step={100} style={{ width: '100%' }} placeholder="0 = disabled" />
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
