// Simple test to check if model fetching works
// Note: This test runs outside Electron context, so it can't test IPC directly
console.log('Testing model fetching prerequisites...');

// This is just a conceptual test - actual testing would require
// running in the Electron renderer context
console.log('To test model fetching:');
console.log('1. Start talor-desktop app');
console.log('2. Add an Ollama provider');
console.log('3. Open provider settings');
console.log('4. Check if models are displayed');

// Check if Ollama is running
import http from 'http';
const options = {
  hostname: 'localhost',
  port: 11434,
  path: '/api/tags',
  method: 'GET',
  timeout: 5000
};

const req = http.request(options, (res) => {
  console.log(`Ollama status: ${res.statusCode}`);
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    try {
      const models = JSON.parse(data);
      console.log(`Ollama has ${models.models?.length || 0} models available`);
      if (models.models && models.models.length > 0) {
        console.log('Models:', models.models.map(m => m.name).join(', '));
      }
    } catch (e) {
      console.error('Failed to parse Ollama response:', e.message);
    }
  });
});

req.on('error', (e) => {
  console.error('Ollama not accessible:', e.message);
});

req.on('timeout', () => {
  console.error('Ollama request timeout');
  req.destroy();
});

req.end();