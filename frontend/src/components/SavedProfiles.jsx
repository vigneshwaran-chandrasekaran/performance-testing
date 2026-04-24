/**
 * SavedProfiles.jsx
 *
 * Lets users save named test configurations to localStorage and reload them.
 * This is useful when you run the same endpoints repeatedly — save once, load anytime.
 *
 * Props:
 *  - formRef: a React ref whose .current is an Ant Design Form instance (to set values)
 *  - currentValues: the current form values (used when saving)
 */
import { useState } from 'react';
import {
  Card,
  Button,
  Input,
  List,
  Typography,
  Space,
  Popconfirm,
  Empty,
  Modal,
  Tag,
  Tooltip,
} from 'antd';
import {
  SaveOutlined,
  FolderOpenOutlined,
  DeleteOutlined,
  ProfileOutlined,
} from '@ant-design/icons';

const { Text } = Typography;

// Key used to store profiles in browser localStorage
const STORAGE_KEY = 'load-test-profiles';

// ─── Helper functions for localStorage ───────────────────────────────────────

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveToStorage(profiles) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    console.error('[SavedProfiles] Failed to save to localStorage');
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SavedProfiles({ formRef, currentValues }) {
  const [profiles, setProfiles] = useState(() => loadFromStorage());
  const [modalOpen, setModalOpen] = useState(false);
  const [profileName, setProfileName] = useState('');

  // ── Load a saved profile into the form ──────────────────────────────────
  function handleLoad(profile) {
    if (formRef?.current) {
      // Set all saved field values back into the form
      formRef.current.setFieldsValue(profile.config);
    }
  }

  // ── Delete a saved profile ───────────────────────────────────────────────
  function handleDelete(name) {
    const updated = profiles.filter((p) => p.name !== name);
    setProfiles(updated);
    saveToStorage(updated);
  }

  // ── Save the current form values as a named profile ──────────────────────
  function handleSave() {
    const name = profileName.trim();
    if (!name) return;

    // Read directly from the form instance so we always get the latest values,
    // even if the user hasn't run a test yet
    const config = formRef?.current ? formRef.current.getFieldsValue() : (currentValues || {});

    // Remove any existing profile with the same name (overwrite)
    const filtered = profiles.filter((p) => p.name !== name);
    const newProfile = {
      name,
      savedAt: new Date().toISOString(),
      config,
    };
    const updated = [newProfile, ...filtered];
    setProfiles(updated);
    saveToStorage(updated);
    setProfileName('');
    setModalOpen(false);
  }

  return (
    <>
      <Card
        title={
          <Space>
            <ProfileOutlined style={{ color: '#1677ff' }} />
            <span>Saved Profiles</span>
          </Space>
        }
        extra={
          <Button
            type="primary"
            size="small"
            icon={<SaveOutlined />}
            onClick={() => setModalOpen(true)}
          >
            Save Current
          </Button>
        }
        size="small"
        style={{ marginBottom: 24 }}
        bodyStyle={{ padding: profiles.length === 0 ? 24 : '8px 0' }}
      >
        {profiles.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No saved profiles. Fill in the form above and click 'Save Current'."
          />
        ) : (
          <List
            size="small"
            dataSource={profiles}
            renderItem={(profile) => (
              <List.Item
                key={profile.name}
                style={{ padding: '6px 16px' }}
                actions={[
                  // Load button: fills the form with this profile's config
                  <Tooltip title="Load into form" key="load">
                    <Button
                      type="link"
                      size="small"
                      icon={<FolderOpenOutlined />}
                      onClick={() => handleLoad(profile)}
                    >
                      Load
                    </Button>
                  </Tooltip>,

                  // Delete button: asks for confirmation before removing
                  <Popconfirm
                    key="delete"
                    title={`Delete "${profile.name}"?`}
                    onConfirm={() => handleDelete(profile.name)}
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                  >
                    <Button type="text" size="small" icon={<DeleteOutlined />} danger />
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={<Text strong>{profile.name}</Text>}
                  description={
                    <Space size={4} wrap>
                      <Tag color="blue">{profile.config.method || 'GET'}</Tag>
                      <Text type="secondary" style={{ fontSize: 11, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                        {profile.config.url || '(no url)'}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        · {profile.config.concurrency} workers · {profile.config.tps} TPS
                      </Text>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      {/* ── Save profile modal ── */}
      <Modal
        title="Save Profile"
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => { setModalOpen(false); setProfileName(''); }}
        okText="Save"
        okButtonProps={{ disabled: !profileName.trim() }}
      >
        <p style={{ marginBottom: 8, color: '#595959' }}>
          Give this configuration a name so you can reload it later:
        </p>
        <Input
          placeholder="e.g. Production Login Endpoint"
          value={profileName}
          onChange={(e) => setProfileName(e.target.value)}
          onPressEnter={handleSave}
          autoFocus
          maxLength={80}
        />
      </Modal>
    </>
  );
}
