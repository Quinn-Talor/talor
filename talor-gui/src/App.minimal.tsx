/**
 * Minimal App Component - Step by step loading
 * 最小化 App 组件 - 逐步加载
 */

import React from 'react';

export const AppMinimal: React.FC = () => {
  const [step, setStep] = React.useState(1);
  const [error, setError] = React.useState<string | null>(null);

  const loadNextStep = () => {
    try {
      setStep(step + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui', minHeight: '100vh' }}>
      <h1>Talor GUI - Debug Mode</h1>
      <p>Current Step: {step}</p>

      {error && (
        <div style={{ padding: '15px', background: '#fee', border: '1px solid #c00', borderRadius: '5px', marginBottom: '20px' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {step === 1 && (
        <div>
          <h2>Step 1: Basic React ✓</h2>
          <p>React is rendering successfully!</p>
          <button onClick={loadNextStep} style={{ padding: '10px 20px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
            Load Step 2: i18n
          </button>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2>Step 2: Testing i18n...</h2>
          <TestI18n onSuccess={loadNextStep} onError={setError} />
        </div>
      )}

      {step === 3 && (
        <div>
          <h2>Step 3: Testing Theme Provider...</h2>
          <TestTheme onSuccess={loadNextStep} onError={setError} />
        </div>
      )}

      {step === 4 && (
        <div>
          <h2>Step 4: Testing Router...</h2>
          <TestRouter onSuccess={loadNextStep} onError={setError} />
        </div>
      )}

      {step === 5 && (
        <div>
          <h2>Step 5: Testing Stores...</h2>
          <TestStores onSuccess={loadNextStep} onError={setError} />
        </div>
      )}

      {step === 6 && (
        <div>
          <h2>All Tests Passed! ✓</h2>
          <p>The app should work now. Loading full app...</p>
          <button onClick={() => window.location.reload()} style={{ padding: '10px 20px', background: '#10b981', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
            Load Full App
          </button>
        </div>
      )}
    </div>
  );
};

// Test i18n
const TestI18n: React.FC<{ onSuccess: () => void; onError: (err: string) => void }> = ({ onSuccess, onError }) => {
  React.useEffect(() => {
    const test = async () => {
      try {
        const { default: i18n } = await import('./i18n');
        console.log('i18n loaded:', i18n.language);
        setTimeout(onSuccess, 500);
      } catch (err) {
        onError(`i18n failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    test();
  }, [onSuccess, onError]);

  return <p>Loading i18n...</p>;
};

// Test Theme
const TestTheme: React.FC<{ onSuccess: () => void; onError: (err: string) => void }> = ({ onSuccess, onError }) => {
  React.useEffect(() => {
    const test = async () => {
      try {
        const { ThemeProvider } = await import('./components/common/ThemeProvider');
        console.log('ThemeProvider loaded');
        setTimeout(onSuccess, 500);
      } catch (err) {
        onError(`ThemeProvider failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    test();
  }, [onSuccess, onError]);

  return <p>Loading ThemeProvider...</p>;
};

// Test Router
const TestRouter: React.FC<{ onSuccess: () => void; onError: (err: string) => void }> = ({ onSuccess, onError }) => {
  React.useEffect(() => {
    const test = async () => {
      try {
        const { AppRouter } = await import('./router');
        console.log('Router loaded');
        setTimeout(onSuccess, 500);
      } catch (err) {
        onError(`Router failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    test();
  }, [onSuccess, onError]);

  return <p>Loading Router...</p>;
};

// Test Stores
const TestStores: React.FC<{ onSuccess: () => void; onError: (err: string) => void }> = ({ onSuccess, onError }) => {
  React.useEffect(() => {
    const test = async () => {
      try {
        const { useSessionStore } = await import('./store/session');
        const { useUIStore } = await import('./store/ui');
        console.log('Stores loaded');
        setTimeout(onSuccess, 500);
      } catch (err) {
        onError(`Stores failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    test();
  }, [onSuccess, onError]);

  return <p>Loading Stores...</p>;
};

export default AppMinimal;
