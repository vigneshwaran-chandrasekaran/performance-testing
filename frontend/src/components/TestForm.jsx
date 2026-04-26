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
  PlusOutlined,
  DeleteOutlined,
  BellOutlined,
  SafetyOutlined,
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
  // Assertions: array of {id, type, operator, value}
  const [assertions, setAssertions] = useState([]);
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

      // Convert body to a JSON string for the textarea.
      // Three cases:
      //  1. content-type is application/x-www-form-urlencoded → parse key=value pairs → JSON object
      //  2. body is already valid JSON → pretty-print it
      //  3. anything else → leave as plain string (validator will flag it)
      let bodyStr = '';
      if (body) {
        const contentType = (headers['Content-Type'] || headers['content-type'] || '').toLowerCase();
        if (contentType.includes('application/x-www-form-urlencoded')) {
          // Convert URL-encoded form data to a JSON object so the body field accepts it
          try {
            const params = new URLSearchParams(body);
            const obj = {};
            for (const [key, value] of params.entries()) {
              obj[key] = value;
            }
            bodyStr = JSON.stringify(obj, null, 2);
          } catch {
            bodyStr = body;
          }
        } else {
          try {
            bodyStr = JSON.stringify(JSON.parse(body), null, 2);
          } catch {
            bodyStr = body; // not JSON — leave as plain string
          }
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
        // Response assertions (empty array = no assertions)
        assertions: assertions.filter((a) => a.type && a.value !== ''),
        // Webhook notification URL (empty = disabled)
        webhookUrl: values.webhookUrl ? values.webhookUrl.trim() : null,
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
              tooltip="The web address of the API you want to test. Example: https://api.example.com/users — copy it from your browser, Postman, or API docs."
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
            <Form.Item label="HTTP Method" name="method" tooltip="GET = fetch/read data (no body needed). POST = send/create. PUT = replace/update. DELETE = remove. PATCH = partial update.">
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
                  <Tooltip title="Extra info sent with every request — like showing an ID badge. 'Authorization' holds your login token. 'Content-Type: application/json' tells the server you're sending JSON data.">
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
                  <Tooltip title="Data you send with the request — like filling in a form. Only needed when creating or updating something (POST/PUT/PATCH). Leave blank for GET requests.">
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
                  <Tooltip title="How many users hit the server at the same time. Example: 50 = 50 simultaneous users all sending requests. Higher values stress the server more.">
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
                  <Tooltip title="How many requests to send every second — like a speed limit. Example: 10 = 10 requests/second. Set to 0 to go as fast as possible (no limit).">
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
              tooltip="How long the test runs, in seconds. 60 = 1 minute of traffic. Start small (10–30s) to avoid overloading your server."
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
                  <Tooltip title="If a request fails due to a network error, retry this many times before counting it as a failure. Like redialling a busy number. 0 = no retries.">
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
                  <Tooltip title="How long to wait for a server response before giving up. 10000 = 10 seconds. If the server doesn't reply in time, it counts as an error.">
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
                  <Tooltip title="Constant = same speed the whole test. Ramp-up = starts slow and builds up gradually (like a morning rush). Step = increases load in chunks (like opening more checkout lanes every few minutes).">
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
                  <Tooltip title="Pause between requests — simulates a real user who reads the page before clicking again. 1000 = 1 second pause. 0 = fire back-to-back with no break (more aggressive test).">
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
                    <Tooltip title="How many seconds to slowly build up to full speed. Like opening a tap gradually instead of all at once. 0 = start at full speed immediately.">
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
                      <Tooltip title="How many extra requests/second to add at each step. Example: 10 = add 10 more req/s each time the load increases.">
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
                      <Tooltip title="How many seconds to wait before increasing the load again. Example: 30 = every 30 seconds, add another Step Size worth of requests.">
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
              tooltip="Auto-stop: if more than X% of requests fail, the test stops to protect your server. Example: 5 = stop when 5% fail. 0 = never auto-stop based on errors."
            >
              <InputNumber min={0} max={100} step={1} style={{ width: '100%' }} placeholder="0 = disabled" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              label="Max P95 Latency (ms)"
              name="maxP95"
              tooltip="Auto-stop: if 95% of responses are slower than X milliseconds, the test stops. P95 = the slowest 5% of requests. Example: 2000 = stop when responses regularly exceed 2 seconds. 0 = disabled."
            >
              <InputNumber min={0} max={60000} step={100} style={{ width: '100%' }} placeholder="0 = disabled" />
            </Form.Item>
          </Col>
        </Row>

        {/* ─── Response Assertions ────────────────────────────────────────────
            Rules checked against each response. Tracks pass/fail separately
            from HTTP success so you can validate business logic (e.g. body
            must contain "status":"ok") without it counting as a network failure.
        ──────────────────────────────────────────────────────────────────────── */}
        <Divider orientation="left" style={{ fontSize: 13, color: '#595959', marginTop: 8 }}>
          <Space>
            <SafetyOutlined />
            Response Assertions
          </Space>
        </Divider>

        {assertions.map((a, idx) => (
          <Row gutter={8} key={a.id} style={{ marginBottom: 8 }} align="middle">
            {/* Assertion type */}
            <Col xs={24} sm={7}>
              <Select
                value={a.type}
                style={{ width: '100%' }}
                placeholder="Type"
                onChange={(val) => {
                  const next = [...assertions];
                  next[idx] = { ...next[idx], type: val, operator: val === 'statusCode' ? 'equals' : undefined, value: '' };
                  setAssertions(next);
                }}
                options={[
                  { label: 'Status Code', value: 'statusCode' },
                  { label: 'Body Contains', value: 'bodyContains' },
                  { label: 'Body Not Contains', value: 'bodyNotContains' },
                  { label: 'Response Time Below (ms)', value: 'responseTimeBelow' },
                ]}
                disabled={isRunning}
              />
            </Col>

            {/* Operator — only for statusCode */}
            {a.type === 'statusCode' && (
              <Col xs={24} sm={5}>
                <Select
                  value={a.operator || 'equals'}
                  style={{ width: '100%' }}
                  onChange={(val) => {
                    const next = [...assertions];
                    next[idx] = { ...next[idx], operator: val };
                    setAssertions(next);
                  }}
                  options={[
                    { label: '= equals', value: 'equals' },
                    { label: '≠ not equals', value: 'notEquals' },
                    { label: '≥ gte', value: 'gte' },
                    { label: '≤ lte', value: 'lte' },
                  ]}
                  disabled={isRunning}
                />
              </Col>
            )}

            {/* Value */}
            <Col xs={24} sm={a.type === 'statusCode' ? 9 : 14}>
              <Input
                value={a.value}
                placeholder={
                  a.type === 'statusCode' ? 'e.g. 200'
                  : a.type === 'responseTimeBelow' ? 'e.g. 2000'
                  : 'e.g. "success"'
                }
                onChange={(e) => {
                  const next = [...assertions];
                  next[idx] = { ...next[idx], value: e.target.value };
                  setAssertions(next);
                }}
                disabled={isRunning}
              />
            </Col>

            {/* Remove button */}
            <Col xs={2} sm={2}>
              <Button
                danger
                type="text"
                icon={<DeleteOutlined />}
                onClick={() => setAssertions(assertions.filter((_, i) => i !== idx))}
                disabled={isRunning}
              />
            </Col>
          </Row>
        ))}

        <Button
          type="dashed"
          icon={<PlusOutlined />}
          onClick={() => setAssertions([...assertions, { id: Date.now(), type: 'statusCode', operator: 'equals', value: '200' }])}
          disabled={isRunning}
          style={{ marginBottom: 16 }}
        >
          Add Assertion
        </Button>

        {/* ─── Webhook Notification ───────────────────────────────────────────
            POST a JSON summary to this URL when the test completes.
            Works with Slack incoming webhooks, Discord, or any HTTP endpoint.
        ──────────────────────────────────────────────────────────────────────── */}
        <Divider orientation="left" style={{ fontSize: 13, color: '#595959', marginTop: 8 }}>
          <Space>
            <BellOutlined />
            Webhook Notification
          </Space>
        </Divider>
        <Form.Item
          label={
            <Space>
              Webhook URL
              <Tooltip title="When the test finishes, a POST request with the results is sent to this URL. Works with Slack, Discord, or any HTTP endpoint. Leave blank to disable.">
                <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
              </Tooltip>
            </Space>
          }
          name="webhookUrl"
          rules={[{
            validator: (_, val) => {
              if (!val || val.trim() === '') return Promise.resolve();
              try { new URL(val); return Promise.resolve(); }
              catch { return Promise.reject('Enter a valid URL'); }
            },
          }]}
        >
          <Input
            placeholder="https://hooks.slack.com/services/... or https://discord.com/api/webhooks/..."
            allowClear
          />
        </Form.Item>

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

      {/* ── Field Guide ──────────────────────────────────────────────────────
          Collapsed by default. Click to expand for plain-English descriptions
          of every field — helpful for first-time users or beginners.
      ──────────────────────────────────────────────────────────────────────── */}
      <Divider style={{ margin: '20px 0 12px' }} />
      <Collapse
        ghost
        size="small"
        items={[{
          key: 'guide',
          label: <span style={{ color: '#8c8c8c', fontSize: 13 }}>📖 Field Guide — what does each setting do? (click to expand)</span>,
          children: (
            <Row gutter={[16, 0]} style={{ fontSize: 13, color: '#595959', lineHeight: 2 }}>
              <Col xs={24} sm={12}>
                <ul style={{ paddingLeft: 18, margin: 0 }}>
                  <li><strong>API URL</strong> — the address of your API, e.g. https://api.example.com/users</li>
                  <li><strong>Method</strong> — GET = read data, POST = send data, PUT = update, DELETE = remove</li>
                  <li><strong>Headers</strong> — extra info per request, e.g. your auth token or content type</li>
                  <li><strong>Body</strong> — data sent with POST/PUT requests (leave blank for GET)</li>
                  <li><strong>Concurrency</strong> — how many users hit the server at the same time</li>
                  <li><strong>TPS</strong> — requests per second (0 = no speed limit)</li>
                  <li><strong>Duration</strong> — how many seconds the test runs for</li>
                  <li><strong>Retries</strong> — retry a failed request N times before counting it as an error</li>
                  <li><strong>Timeout</strong> — give up waiting for a response after X milliseconds</li>
                </ul>
              </Col>
              <Col xs={24} sm={12}>
                <ul style={{ paddingLeft: 18, margin: 0 }}>
                  <li><strong>Load Profile</strong> — shape of traffic: constant speed, gradual ramp-up, or step increases</li>
                  <li><strong>Think Time</strong> — pause between requests (simulates a real user reading the page)</li>
                  <li><strong>Ramp-up</strong> — seconds to slowly reach full speed from 0</li>
                  <li><strong>Step Size</strong> — how much TPS to add at each load step</li>
                  <li><strong>Step Interval</strong> — seconds between each load increase</li>
                  <li><strong>Max Error Rate</strong> — auto-stop the test if X% of requests fail</li>
                  <li><strong>Max P95</strong> — auto-stop if 95% of responses are slower than X ms</li>
                  <li><strong>Variables</strong> — use <Text code>{'{{'+'random_uuid'+'}}'},  {'{{'+'random_int'+'}}'},  {'{{'+'timestamp'+'}}' }</Text> in URL/body to send different data each request</li>
                </ul>
              </Col>
            </Row>
          ),
        }]}
      />
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
