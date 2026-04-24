import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ConfigProvider, Layout, Typography, theme, Menu } from 'antd';
import { ThunderboltOutlined, DashboardOutlined } from '@ant-design/icons';
import LoadTest from './pages/LoadTest';
import Benchmark from './pages/Benchmark';

const { Header, Content } = Layout;
const { Title } = Typography;

// Navigation menu items — one entry per page/route
const NAV_ITEMS = [
  {
    key: '/load-test',
    icon: <DashboardOutlined />,
    label: 'Load Test',
  },
  {
    key: '/benchmark',
    icon: <ThunderboltOutlined />,
    label: 'Quick Benchmark',
  },
];

// AppContent is a separate component so it can use React Router hooks
// (useLocation / useNavigate) which only work inside a <BrowserRouter>
function AppContent() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          background: 'linear-gradient(135deg, #1677ff 0%, #0958d9 100%)',
          padding: '0 24px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}
      >
        {/* App logo + title */}
        <ThunderboltOutlined style={{ color: '#fff', fontSize: 22, marginRight: 10 }} />
        <Title level={4} style={{ color: '#fff', margin: 0, letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
          API Load Tester
        </Title>

        {/* Navigation tabs — highlighted based on current route */}
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[location.pathname]}
          items={NAV_ITEMS}
          onClick={({ key }) => navigate(key)}
          style={{
            background: 'transparent',
            flex: 1,
            marginLeft: 32,
            borderBottom: 'none',
            minWidth: 0,
          }}
        />
      </Header>

      <Content style={{ padding: '24px', maxWidth: 1400, margin: '0 auto', width: '100%' }}>
        <Routes>
          {/* Default route: redirect / to Load Test */}
          <Route path="/" element={<Navigate to="/load-test" replace />} />

          {/* Full-featured load test (custom engine, ramp-up, SLA, variables) */}
          <Route path="/load-test" element={<LoadTest />} />

          {/* Quick benchmark powered by autocannon (raw throughput + percentiles) */}
          <Route path="/benchmark" element={<Benchmark />} />
        </Routes>
      </Content>
    </Layout>
  );
}

export default function App() {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 6,
        },
      }}
    >
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </ConfigProvider>
  );
}
