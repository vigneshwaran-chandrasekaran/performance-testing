import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, Layout, Typography, theme } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import LoadTest from './pages/LoadTest';

const { Header, Content } = Layout;
const { Title } = Typography;

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
            <ThunderboltOutlined style={{ color: '#fff', fontSize: 22, marginRight: 10 }} />
            <Title level={4} style={{ color: '#fff', margin: 0, letterSpacing: 0.5 }}>
              API Load Tester
            </Title>
            <span style={{ color: 'rgba(255,255,255,0.65)', marginLeft: 12, fontSize: 13 }}>
              JMeter-style performance testing
            </span>
          </Header>

          <Content style={{ padding: '24px', maxWidth: 1400, margin: '0 auto', width: '100%' }}>
            <Routes>
              <Route path="/" element={<Navigate to="/load-test" replace />} />
              <Route path="/load-test" element={<LoadTest />} />
            </Routes>
          </Content>
        </Layout>
      </BrowserRouter>
    </ConfigProvider>
  );
}
