import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AppSimple from './App.simple.tsx';

console.log('=== Talor GUI Simple Mode ===');
console.log('Starting initialization...');

try {
  const rootElement = document.getElementById('root');

  if (!rootElement) {
    throw new Error('Root element not found in DOM');
  }

  console.log('Root element found:', rootElement);
  console.log('Creating React root...');

  const root = createRoot(rootElement);

  console.log('Rendering app...');
  root.render(
    <StrictMode>
      <AppSimple />
    </StrictMode>
  );

  console.log('✓ App rendered successfully!');
} catch (error) {
  console.error('✗ Failed to initialize app:', error);

  // Show error on page
  document.body.innerHTML = `
    <div style="padding: 20px; font-family: system-ui; max-width: 800px; margin: 50px auto; background: #fee; border: 2px solid #c00; border-radius: 8px;">
      <h1 style="color: #c00; margin: 0 0 10px 0;">Failed to Initialize Talor GUI</h1>
      <p style="margin: 10px 0;"><strong>Error:</strong></p>
      <pre style="background: #fff; padding: 15px; border-radius: 5px; overflow-x: auto; border: 1px solid #ddd;">${error instanceof Error ? error.message : String(error)}</pre>
      <p style="margin: 15px 0 10px 0;"><strong>Stack:</strong></p>
      <pre style="background: #fff; padding: 15px; border-radius: 5px; overflow-x: auto; border: 1px solid #ddd; font-size: 12px;">${error instanceof Error ? error.stack : 'No stack trace'}</pre>
      <button onclick="location.reload()" style="margin-top: 15px; padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 14px;">
        Reload Page
      </button>
    </div>
  `;
}
