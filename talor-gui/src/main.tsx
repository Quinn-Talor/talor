import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Add global error handler for debugging
window.addEventListener('error', (event) => {
  console.error('Global error caught:', event.error);
  console.error('Error message:', event.message);
  console.error('Error stack:', event.error?.stack);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});

try {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element not found');
  }

  console.log('Initializing React app...');
  const root = createRoot(rootElement);

  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );

  console.log('React app rendered successfully');
} catch (error) {
  console.error('Failed to initialize React app:', error);
  document.body.innerHTML = `
    <div style="padding: 20px; font-family: system-ui; max-width: 800px; margin: 50px auto;">
      <h1 style="color: #dc2626;">Failed to Initialize Talor GUI</h1>
      <p>An error occurred while starting the application:</p>
      <pre style="background: #f3f4f6; padding: 15px; border-radius: 5px; overflow-x: auto;">${error instanceof Error ? error.message : String(error)}</pre>
      <p>Please check the browser console for more details.</p>
      <button onclick="location.reload()" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 5px; cursor: pointer;">
        Reload Page
      </button>
    </div>
  `;
}
