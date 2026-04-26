/**
 * EnvironmentsPanel.jsx
 *
 * Manage named environment variable sets (Dev, Staging, Prod, etc.).
 * Each environment has a name and a list of key-value pairs.
 * The active environment's variables are substituted into URL, headers,
 * and body before the test starts: {{VAR_NAME}} → value.
 *
 * Data is stored in localStorage under 'loadtest_environments'.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Button,
  Space,
  Input,
  Select,
  Table,
  Typography,
  Tag,
  Tooltip,
  Divider,
  Popconfirm,
  message,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
  EnvironmentOutlined,
  CopyOutlined,
} from '@ant-design/icons';

const { Text } = Typography;
const STORAGE_KEY = 'loadtest_environments';

// ─── Default empty state ──────────────────────────────────────────────────────

function makeEmptyEnv(name = 'New Environment') {
  return { id: Date.now(), name, vars: [] };
}

function makeEmptyVar() {
  return { id: Date.now(), key: '', value: '' };
}

// ─── Load / Save helpers ──────────────────────────────────────────────────────

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveToStorage(envs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envs));
  } catch {}
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EnvironmentsPanel({ activeEnvId, onActiveEnvChange }) {
  const [environments, setEnvironments] = useState(loadFromStorage);
  const [editingName, setEditingName] = useState(null); // envId currently being renamed
  const [draftName, setDraftName] = useState('');

  // Persist any change to localStorage
  const persist = useCallback((envs) => {
    setEnvironments(envs);
    saveToStorage(envs);
  }, []);

  // Keep parent in sync when environments list changes
  useEffect(() => {
    if (activeEnvId && !environments.find((e) => e.id === activeEnvId)) {
      onActiveEnvChange(null);
    }
  }, [environments, activeEnvId, onActiveEnvChange]);

  const activeEnv = environments.find((e) => e.id === activeEnvId) || null;

  // ── Environment CRUD ───────────────────────────────────────────────────────

  const addEnvironment = () => {
    const env = makeEmptyEnv();
    const next = [...environments, env];
    persist(next);
    onActiveEnvChange(env.id);
    // Start editing the name right away
    setEditingName(env.id);
    setDraftName(env.name);
  };

  const deleteEnvironment = (envId) => {
    persist(environments.filter((e) => e.id !== envId));
    if (activeEnvId === envId) onActiveEnvChange(null);
  };

  const commitRename = (envId) => {
    if (!draftName.trim()) { setEditingName(null); return; }
    persist(environments.map((e) => e.id === envId ? { ...e, name: draftName.trim() } : e));
    setEditingName(null);
  };

  // ── Variable CRUD (within active env) ─────────────────────────────────────

  const addVar = () => {
    if (!activeEnv) return;
    const v = makeEmptyVar();
    persist(environments.map((e) =>
      e.id === activeEnvId ? { ...e, vars: [...e.vars, v] } : e,
    ));
  };

  const deleteVar = (varId) => {
    persist(environments.map((e) =>
      e.id === activeEnvId ? { ...e, vars: e.vars.filter((v) => v.id !== varId) } : e,
    ));
  };

  const updateVar = (varId, field, value) => {
    persist(environments.map((e) =>
      e.id === activeEnvId
        ? { ...e, vars: e.vars.map((v) => v.id === varId ? { ...v, [field]: value } : v) }
        : e,
    ));
  };

  const copySnippet = (key) => {
    const snippet = `{{${key}}}`;
    navigator.clipboard.writeText(snippet).then(() => {
      message.success(`Copied ${snippet} to clipboard`);
    }).catch(() => {
      message.info(`Use ${snippet} in your URL, headers, or body`);
    });
  };

  // ── Columns for the variables table ───────────────────────────────────────

  const varColumns = [
    {
      title: 'Variable Name',
      dataIndex: 'key',
      key: 'key',
      render: (val, record) => (
        <Input
          value={val}
          placeholder="VAR_NAME"
          onChange={(e) => updateVar(record.id, 'key', e.target.value)}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
          addonBefore="{{"
          addonAfter="}}"
        />
      ),
    },
    {
      title: 'Value',
      dataIndex: 'value',
      key: 'value',
      render: (val, record) => (
        <Input
          value={val}
          placeholder="value"
          onChange={(e) => updateVar(record.id, 'value', e.target.value)}
          style={{ fontSize: 12 }}
        />
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_, record) => (
        <Space>
          {record.key && (
            <Tooltip title={`Copy {{${record.key}}}`}>
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => copySnippet(record.key)}
              />
            </Tooltip>
          )}
          <Popconfirm
            title="Delete this variable?"
            onConfirm={() => deleteVar(record.id)}
            okText="Delete"
            okButtonProps={{ danger: true }}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      size="small"
      title={
        <Space>
          <EnvironmentOutlined style={{ color: '#1677ff' }} />
          <span>Environment Variables</span>
          {activeEnv && (
            <Tag color="blue">{activeEnv.name}</Tag>
          )}
        </Space>
      }
      extra={
        <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addEnvironment}>
          New Environment
        </Button>
      }
      style={{ marginBottom: 24 }}
    >
      {/* ── Environment selector ───────────────────────────────────────── */}
      <Space style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>Active:</Text>
        <Select
          value={activeEnvId}
          placeholder="None — no substitutions applied"
          style={{ minWidth: 200 }}
          allowClear
          onChange={onActiveEnvChange}
          options={environments.map((e) => ({ label: e.name, value: e.id }))}
        />
      </Space>

      {/* ── Environment tabs / list ────────────────────────────────────── */}
      {environments.length > 0 && (
        <>
          <Divider style={{ margin: '8px 0' }} />
          <Space wrap style={{ marginBottom: 8 }}>
            {environments.map((env) => (
              <Tag
                key={env.id}
                color={env.id === activeEnvId ? 'blue' : 'default'}
                style={{ cursor: 'pointer', userSelect: 'none' }}
                onClick={() => onActiveEnvChange(env.id)}
              >
                {editingName === env.id ? (
                  <Space size={4}>
                    <Input
                      size="small"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onPressEnter={() => commitRename(env.id)}
                      style={{ width: 120 }}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Button type="text" size="small" icon={<CheckOutlined />} onClick={(e) => { e.stopPropagation(); commitRename(env.id); }} />
                    <Button type="text" size="small" icon={<CloseOutlined />} onClick={(e) => { e.stopPropagation(); setEditingName(null); }} />
                  </Space>
                ) : (
                  <Space size={4}>
                    {env.name}
                    <EditOutlined
                      style={{ fontSize: 11 }}
                      onClick={(e) => { e.stopPropagation(); setEditingName(env.id); setDraftName(env.name); }}
                    />
                    <Popconfirm
                      title={`Delete "${env.name}"?`}
                      onConfirm={(e) => { e?.stopPropagation(); deleteEnvironment(env.id); }}
                      okText="Delete"
                      okButtonProps={{ danger: true }}
                    >
                      <CloseOutlined style={{ fontSize: 11 }} onClick={(e) => e.stopPropagation()} />
                    </Popconfirm>
                  </Space>
                )}
              </Tag>
            ))}
          </Space>
        </>
      )}

      {/* ── Variables table for the active environment ────────────────── */}
      {activeEnv ? (
        <>
          <Divider orientation="left" style={{ fontSize: 12, margin: '8px 0' }}>
            Variables in &quot;{activeEnv.name}&quot;
          </Divider>
          <Table
            size="small"
            columns={varColumns}
            dataSource={activeEnv.vars}
            rowKey="id"
            pagination={false}
            locale={{ emptyText: 'No variables yet — click "Add Variable" to start' }}
          />
          <Button
            type="dashed"
            size="small"
            icon={<PlusOutlined />}
            onClick={addVar}
            style={{ marginTop: 8 }}
          >
            Add Variable
          </Button>
          <div style={{ marginTop: 10 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              Use <Text code style={{ fontSize: 11 }}>{'{{VAR_NAME}}'}</Text> in URL, Headers, or Body.
              Click <CopyOutlined /> next to any variable to copy its template snippet.
            </Text>
          </div>
        </>
      ) : (
        environments.length > 0 ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Select an environment above to view and edit its variables.
          </Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Create an environment to define reusable variables (base URLs, tokens, etc.)
            that get substituted into your request before each test run.
          </Text>
        )
      )}
    </Card>
  );
}

// ─── Utility: apply active environment substitutions ─────────────────────────
// Call this before starting a test to replace {{KEY}} with the env value.
// Returns a new config object with substitutions applied.
export function applyEnvironment(config, environments, activeEnvId) {
  if (!activeEnvId) return config;
  const env = environments.find((e) => e.id === activeEnvId);
  if (!env || !env.vars.length) return config;

  function substitute(str) {
    if (!str || typeof str !== 'string') return str;
    let result = str;
    for (const v of env.vars) {
      if (v.key) {
        result = result.replace(new RegExp(`\\{\\{${v.key}\\}\\}`, 'g'), v.value);
      }
    }
    return result;
  }

  const newConfig = { ...config };
  if (newConfig.url) newConfig.url = substitute(newConfig.url);
  if (newConfig.headers && typeof newConfig.headers === 'object') {
    const resolved = {};
    for (const [k, v] of Object.entries(newConfig.headers)) {
      resolved[substitute(k)] = substitute(v);
    }
    newConfig.headers = resolved;
  }
  if (newConfig.body) {
    if (typeof newConfig.body === 'string') {
      newConfig.body = substitute(newConfig.body);
    } else {
      try {
        const str = JSON.stringify(newConfig.body);
        newConfig.body = JSON.parse(substitute(str));
      } catch {}
    }
  }
  return newConfig;
}
