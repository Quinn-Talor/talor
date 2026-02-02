import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function SimpleApp() {
  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Talor GUI - 简单测试</h1>
      <p>如果你能看到这个页面，说明 React 正常工作。</p>
      <button onClick={() => alert('按钮点击成功！')}>
        测试按钮
      </button>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <SimpleApp />
    </StrictMode>
  );
} else {
  console.error('Root element not found!');
}
