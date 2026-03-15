/**
 * Admin and Reporting endpoint test script.
 * Run with: node test-admin.js
 */
const http = require('http');
const jwt = require('jsonwebtoken');

const BASE = 'http://localhost:5000';
const JWT_SECRET = 'your-super-secure-jwt-secret-min-32-chars';
const TIMEOUT_MS = 5000;

// Generate test JWTs
const studentToken = jwt.sign(
  { userId: '550e8400-e29b-41d4-a716-446655440000', role: 'student', type: 'access' },
  JWT_SECRET, { expiresIn: '1h' }
);
const adminToken = jwt.sign(
  { userId: '990e8400-e29b-41d4-a716-446655440003', role: 'admin', type: 'access' },
  JWT_SECRET, { expiresIn: '1h' }
);

let testNum = 0, passed = 0, failed = 0;

function request(method, path, body, token) {
  return new Promise((resolve) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname, port: url.port,
      path: url.pathname + url.search, method,
      headers: { 'Content-Type': 'application/json' },
      timeout: TIMEOUT_MS,
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
    req.on('timeout', () => { req.destroy(); resolve({ status: 'TIMEOUT', body: {} }); });
    req.on('error', (e) => resolve({ status: 0, body: { error: e.message } }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function assert(name, actual, expected) {
  testNum++;
  if (actual === expected) { passed++; console.log(`  ✅ #${testNum} ${name} — ${actual}`); }
  else { failed++; console.log(`  ❌ #${testNum} ${name} — expected ${expected}, got ${actual}`); }
}

async function runTests() {
  console.log('\n========================================');
  console.log('  JOE Cafeteria — Admin Test Suite');
  console.log('========================================\n');

  // --- ACCESS CONTROL ---
  console.log('📋 Access Control');
  let r = await request('GET', '/api/v1/admin/users', null, studentToken);
  assert('Student accessing admin routes → 403', r.status, 403);
  
  r = await request('GET', '/api/v1/admin/users', null, adminToken);
  assert('Admin accessing admin routes → 200', r.status, 200);

  // --- ADMIN USERS ---
  console.log('\n📋 Admin User Management');
  r = await request('GET', '/api/v1/admin/users', null, adminToken);
  assert('GET /admin/users data exists', Array.isArray(r.body?.data?.users), true);

  // --- SYSTEM SETTINGS ---
  console.log('\n📋 System Settings');
  r = await request('GET', '/api/v1/admin/settings', null, adminToken);
  assert('GET /admin/settings → 200', r.status, 200);
  assert('Settings has maintenance mode', typeof r.body?.data?.settings?.is_maintenance_mode, 'boolean');

  r = await request('PATCH', '/api/v1/admin/settings', { announcement: 'Welcome to JOE Cafeteria!' }, adminToken);
  assert('PATCH /admin/settings → 200', r.status, 200);
  assert('Settings announcement updated', r.body?.data?.settings?.announcement, 'Welcome to JOE Cafeteria!');

  // --- AUDIT LOGS ---
  console.log('\n📋 Audit Logs');
  r = await request('GET', '/api/v1/admin/audit-logs', null, adminToken);
  assert('GET /admin/audit-logs → 200', r.status, 200);
  assert('Logs array exists', Array.isArray(r.body?.data?.logs), true);

  // --- REPORTING ---
  console.log('\n📋 Reporting');
  r = await request('GET', '/api/v1/reports/daily', null, adminToken);
  assert('GET /reports/daily → 200', r.status, 200);
  assert('Daily report has total_orders', typeof r.body?.data?.total_orders, 'number');

  r = await request('GET', '/api/v1/reports/revenue?startDate=2024-03-01&endDate=2024-03-31', null, adminToken);
  assert('GET /reports/revenue → 200', r.status, 200);

  r = await request('GET', '/api/v1/reports/export?startDate=2024-03-01&endDate=2024-03-31&format=csv', null, adminToken);
  assert('GET /reports/export (csv) → 200', r.status, 200);

  // === SUMMARY ===
  console.log('\n========================================');
  console.log(`  Results: ${passed} passed, ${failed} failed out of ${testNum}`);
  console.log('========================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
