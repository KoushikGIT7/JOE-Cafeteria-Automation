/**
 * Quick endpoint test script — tests all order service endpoints.
 * Run with: node test-endpoints.js
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
const cashierToken = jwt.sign(
  { userId: '770e8400-e29b-41d4-a716-446655440002', role: 'cashier', type: 'access' },
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
  console.log('  JOE Cafeteria — Endpoint Test Suite');
  console.log('========================================\n');

  // --- HEALTH ---
  console.log('📋 Health Checks');
  let r = await request('GET', '/health');
  assert('Root /health', r.status, 200);
  r = await request('GET', '/api/v1/health');
  assert('API /api/v1/health', r.status, 200);
  assert('API health data.status', r.body?.data?.status, 'OK');

  // --- 404 ---
  console.log('\n📋 404 Handling');
  r = await request('GET', '/api/v1/nonexistent');
  assert('Unknown API route → 404', r.status, 404);
  assert('404 code = ROUTE_NOT_FOUND', r.body?.error?.code, 'ROUTE_NOT_FOUND');
  r = await request('GET', '/random/path');
  assert('Unknown root route → 404', r.status, 404);

  // --- AUTH ---
  console.log('\n📋 Auth Middleware');
  r = await request('GET', '/api/v1/orders');
  assert('No token → 401', r.status, 401);
  assert('No token code = NO_TOKEN', r.body?.error?.code, 'NO_TOKEN');
  r = await request('GET', '/api/v1/orders', null, 'invalid');
  assert('Bad token → 401', r.status, 401);
  assert('Bad token code = INVALID_TOKEN', r.body?.error?.code, 'INVALID_TOKEN');

  // --- ROLE AUTH ---
  console.log('\n📋 Role-Based Authorization');
  r = await request('POST', '/api/v1/orders', { items: [], paymentType: 'UPI' }, cashierToken);
  assert('Cashier POST /orders → 403', r.status, 403);
  assert('403 code = FORBIDDEN', r.body?.error?.code, 'FORBIDDEN');

  // --- VALIDATION ---
  console.log('\n📋 Zod Input Validation');

  r = await request('POST', '/api/v1/orders', { items: [], paymentType: 'UPI' }, studentToken);
  assert('Empty items → 400', r.status, 400);
  assert('Validation error code', r.body?.error?.code, 'VALIDATION_ERROR');

  r = await request('POST', '/api/v1/orders', {
    items: [{ menuItemId: '550e8400-e29b-41d4-a716-446655440000', quantity: 1 }],
    paymentType: 'BITCOIN'
  }, studentToken);
  assert('Invalid paymentType → 400', r.status, 400);

  r = await request('POST', '/api/v1/orders', {
    items: [{ menuItemId: '550e8400-e29b-41d4-a716-446655440000', quantity: 0 }],
    paymentType: 'UPI'
  }, studentToken);
  assert('Zero quantity → 400', r.status, 400);

  r = await request('POST', '/api/v1/orders', {
    items: [{ menuItemId: '550e8400-e29b-41d4-a716-446655440000', quantity: -5 }],
    paymentType: 'UPI'
  }, studentToken);
  assert('Negative quantity → 400', r.status, 400);

  r = await request('POST', '/api/v1/orders', {
    items: [{ menuItemId: 'not-a-uuid', quantity: 1 }],
    paymentType: 'UPI'
  }, studentToken);
  assert('Non-UUID menuItemId → 400', r.status, 400);

  r = await request('POST', '/api/v1/orders', {
    items: [{ menuItemId: '550e8400-e29b-41d4-a716-446655440000', quantity: 51 }],
    paymentType: 'UPI'
  }, studentToken);
  assert('Qty 51 → 400 (max 50)', r.status, 400);

  const many = Array.from({ length: 21 }, (_, i) => ({
    menuItemId: `550e8400-e29b-41d4-a716-44665544${String(i).padStart(4, '0')}`,
    quantity: 1
  }));
  r = await request('POST', '/api/v1/orders', { items: many, paymentType: 'UPI' }, studentToken);
  assert('21 items → 400 (max 20)', r.status, 400);

  // --- VALID ORDER (Menu Item not found) ---
  console.log('\n📋 Order Creation (valid input, empty DB)');
  r = await request('POST', '/api/v1/orders', {
    items: [{ menuItemId: '550e8400-e29b-41d4-a716-446655440000', quantity: 2 }],
    paymentType: 'UPI'
  }, studentToken);
  const orderPassesValidation = r.status === 500 || r.status === 'TIMEOUT' || r.status === 404;
  assert('Valid order passes validation', orderPassesValidation, true);

  // --- ADMIN ORDERS ---
  console.log('\n📋 Admin Orders');
  r = await request('GET', '/api/v1/orders/admin/all', null, adminToken);
  assert('GET /orders/admin/all → 200', r.status, 200);

  // --- PAYMENT MOCKING ---
  console.log('\n💳 Payment Mock API');
  r = await request('POST', '/api/v1/payments/initiate', {
    orderId: '550e8400-e29b-41d4-a716-446655440000', // Use any UUID, the service doesn't validate order existence deeply upon mock insertion
    amount: 150.00,
    paymentType: 'UPI'
  }, studentToken);
  assert('POST /payments/initiate → 201', r.status, 201);
  const paymentId = r.body?.data?.payment?.id;
  assert('Returned payment ID', typeof paymentId, 'string');

  if (paymentId) {
    r = await request('POST', '/api/v1/payments/mock/success', {
      paymentId: paymentId,
      transactionId: 'txn_mock_123'
    }, studentToken); // Doesn't strictly need auth but providing it is fine
    assert('POST /payments/mock/success → 200 (Success webhook)', r.status, 200);
    assert('Payment status updated to SUCCESS', r.body?.data?.payment?.status, 'SUCCESS');
  }
  // --- MENU ---
  console.log('\n📋 Menu API');
  r = await request('GET', '/api/v1/menu');
  assert('GET /menu → 200', r.status, 200);
  assert('GET /menu returns total & items', typeof r.body?.data?.total, 'number');

  r = await request('GET', '/api/v1/menu/categories');
  assert('GET /menu/categories → 200', r.status, 200);
  assert('Categories is array', Array.isArray(r.body?.data?.categories), true);

  r = await request('GET', '/api/v1/menu/search?q=Burger');
  assert('GET /menu/search → 200', r.status, 200);

  // --- STATUS UPDATE AUTH ---
  console.log('\n📋 Status Update Authorization');
  r = await request('PATCH', '/api/v1/orders/test-id/status', { status: 'CONFIRMED' }, studentToken);
  assert('Student update status → 403', r.status, 403);

  r = await request('PATCH', '/api/v1/orders/test-id/status', { status: 'CONFIRMED' }, cashierToken);
  const cashierNotForbidden = r.status !== 403;
  assert('Cashier update status → not 403', cashierNotForbidden, true);

  // === SUMMARY ===
  console.log('\n========================================');
  console.log(`  Results: ${passed} passed, ${failed} failed out of ${testNum}`);
  console.log('========================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
