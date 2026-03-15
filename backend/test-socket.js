/**
 * Socket.io event test script.
 * Run with: node test-socket.js
 */
const { io } = require('socket.io-client');
const jwt = require('jsonwebtoken');

const SOCKET_URL = 'http://localhost:5000';
const JWT_SECRET = 'your-super-secure-jwt-secret-min-32-chars';

// Generate test JWTs
const studentId = '550e8400-e29b-41d4-a716-446655440000';
const studentToken = jwt.sign(
  { userId: studentId, role: 'student', type: 'access' },
  JWT_SECRET, { expiresIn: '1h' }
);

const cashierId = '770e8400-e29b-41d4-a716-446655440002';
const cashierToken = jwt.sign(
  { userId: cashierId, role: 'cashier', type: 'access' },
  JWT_SECRET, { expiresIn: '1h' }
);

async function testSocket() {
  console.log('\n========================================');
  console.log('  JOE Cafeteria — Socket Test Suite');
  console.log('========================================\n');

  // 1. Test Student Connection
  console.log('🔌 Testing Student Connection...');
  const studentSocket = io(SOCKET_URL, {
    auth: { token: studentToken }
  });

  studentSocket.on('connect', () => {
    console.log('  ✅ Student socket connected');
  });

  studentSocket.on('order:updated', (data) => {
    console.log('  🔔 Received order:updated event:', data);
    if (data.status === 'CONFIRMED') {
      console.log('  ✅ Real-time status update received!');
    }
  });

  // 2. Test Cashier Connection (Staff)
  console.log('🔌 Testing Staff Connection...');
  const staffSocket = io(SOCKET_URL, {
    auth: { token: cashierToken }
  });

  staffSocket.on('connect', () => {
    console.log('  ✅ Staff socket connected');
  });

  staffSocket.on('order:created', (data) => {
    console.log('  🔔 Received order:created event:', data);
    console.log('  ✅ Real-time new order alert received!');
  });

  // Wait for connections
  await new Promise(resolve => setTimeout(resolve, 2000));

  if (studentSocket.connected && staffSocket.connected) {
    console.log('\n💡 Both sockets connected. You can now use test-endpoints.js or postman to trigger events.');
    console.log('   Example: PATCH /api/v1/orders/:id/status will trigger order:updated on student socket.');
  } else {
    console.log('  ❌ Connection failed.');
  }

  // Keep alive for a bit to receive events or exit if manual
  console.log('\nWaiting for events (10s)...');
  await new Promise(resolve => setTimeout(resolve, 10000));

  studentSocket.close();
  staffSocket.close();
  console.log('\nDone.');
  process.exit(0);
}

testSocket().catch(console.error);
