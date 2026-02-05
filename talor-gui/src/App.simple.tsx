/**
 * Simplified App Component for Debugging
 * 简化的 App 组件用于调试
 */

import React from 'react';

export const AppSimple: React.FC = () => {
  return (
    <div style={{
      padding: '20px',
      fontFamily: 'system-ui',
      minHeight: '100vh',
      background: '#f5f5f5'
    }}>
      <h1 style={{ color: '#333' }}>Talor GUI - Simple Test</h1>
      <p style={{ color: '#666' }}>If you can see this, React is working!</p>
      <div style={{
        marginTop: '20px',
        padding: '15px',
        background: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <h2 style={{ color: '#333', fontSize: '18px' }}>Status Checks:</h2>
        <ul style={{ color: '#666' }}>
          <li>✓ React is rendering</li>
          <li>✓ JavaScript is working</li>
          <li>✓ Styles are applying</li>
        </ul>
      </div>
      <button
        onClick={() => alert('Button works!')}
        style={{
          marginTop: '20px',
          padding: '10px 20px',
          background: '#3b82f6',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '14px'
        }}
      >
        Test Button
      </button>
    </div>
  );
};

export default AppSimple;
