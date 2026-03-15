/**
 * QR API test script.
 * Run with: node test-qr.js
 */
const http = require('http');
const jwt = require('jsonwebtoken');

const BASE = 'http://localhost:5000';
const JWT_SECRET = 'your-super-secure-jwt-secret-min-32-chars';

// Generate test JWT
const staffToken = jwt.sign(
  { userId: '770e8400-e29b-41d4-a716-446655440002', role: 'cashier', type: 'access' },
  JWT_SECRET, { expiresIn: '1h' }
);

function request(method, path, body, token) {
  return new Promise((resolve) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search, method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', (e) => resolve({ status: 0, body: { error: e.message } }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('Testing QR Endpoints...');

  // 1. Health Check
  let r = await request('GET', '/health', null);
  console.log('Health:', r.status === 200 ? '✅' : '❌', r.status);

  // 2. Test QR Status (dummy token)
  r = await request('GET', '/api/v1/qr/dummy-token/status', null, staffToken);
  console.log('QR Status (invalid token):', r.status === 404 ? '✅' : '❌', r.status);

  // 3. Test QR Validation (invalid format)
  r = await request('POST', '/api/v1/qr/validate', { qrToken: 'invalid' }, staffToken);
  console.log('QR Validate (invalid token):', r.status === 404 ? '✅' : '❌', r.status);

  console.log('Tests complete.');
}

runTests().catch(console.error);
