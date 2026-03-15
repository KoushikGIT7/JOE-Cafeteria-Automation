import { query } from '../config/database';

/**
 * Initial database migration.
 * Creates all 10+ tables per BACKEND_DEVELOPMENT_PROMPT.md Section 4.
 */
export async function up(): Promise<void> {
  try {
    // ==========================================
    // 1. USERS table
    // ==========================================
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        firebase_uid VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'student',
        phone VARCHAR(20),
        student_type VARCHAR(50),
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        last_active_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP,

        CHECK (role IN ('student', 'cashier', 'server', 'admin')),
        CHECK (status IN ('active', 'inactive', 'suspended')),
        CHECK (student_type IS NULL OR student_type IN ('dayScholar', 'hosteller'))
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
    `);

    // ==========================================
    // 2. MENU_ITEMS table
    // ==========================================
    await query(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(100) NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        cost_price DECIMAL(10, 2) NOT NULL,
        image_url VARCHAR(1000),
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        allergens TEXT[],
        prep_time_minutes INT,
        calories INT,
        nutrition_info JSONB,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CHECK (category IN ('Breakfast', 'Lunch', 'Snacks', 'Beverages')),
        CHECK (status IN ('active', 'inactive', 'discontinued'))
      );

      CREATE INDEX IF NOT EXISTS idx_menu_category ON menu_items(category);
      CREATE INDEX IF NOT EXISTS idx_menu_status ON menu_items(status);
      CREATE INDEX IF NOT EXISTS idx_menu_created_at ON menu_items(created_at);
    `);

    // ==========================================
    // 3. ORDERS table
    // ==========================================
    await query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        cafeteria_id UUID,

        total_amount DECIMAL(12, 2) NOT NULL,
        tax_amount DECIMAL(10, 2) DEFAULT 0,
        discount_amount DECIMAL(10, 2) DEFAULT 0,
        final_amount DECIMAL(12, 2) NOT NULL,

        order_status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        payment_status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        qr_status VARCHAR(50) NOT NULL DEFAULT 'PENDING_GENERATION',

        payment_type VARCHAR(50) NOT NULL,
        payment_gateway_id VARCHAR(255),
        payment_token VARCHAR(500),
        transaction_id VARCHAR(255) UNIQUE,

        special_instructions TEXT,
        rejection_reason TEXT,

        confirmed_by UUID REFERENCES users(id),
        rejected_by UUID REFERENCES users(id),

        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        confirmed_at TIMESTAMP,
        rejected_at TIMESTAMP,
        scanned_at TIMESTAMP,
        served_at TIMESTAMP,
        completed_at TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CHECK (order_status IN ('PENDING', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'SERVED', 'CANCELLED', 'REJECTED')),
        CHECK (payment_status IN ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED')),
        CHECK (qr_status IN ('PENDING_GENERATION', 'ACTIVE', 'USED', 'EXPIRED', 'REJECTED')),
        CHECK (payment_type IN ('UPI', 'CARD', 'CASH', 'NET'))
      );

      CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status);
      CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
      CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_transaction ON orders(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_orders_user_date ON orders(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_payment_date ON orders(payment_status, created_at DESC);
    `);

    // ==========================================
    // 4. ORDER_ITEMS table
    // ==========================================
    await query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        menu_item_id UUID NOT NULL REFERENCES menu_items(id),
        quantity INT NOT NULL CHECK (quantity > 0),
        unit_price DECIMAL(10, 2) NOT NULL,
        total_price DECIMAL(12, 2) NOT NULL,
        served_qty INT DEFAULT 0,
        remaining_qty INT DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
      CREATE INDEX IF NOT EXISTS idx_order_items_menu ON order_items(menu_item_id);
    `);

    // ==========================================
    // 5. QR_CODES table
    // ==========================================
    await query(`
      CREATE TABLE IF NOT EXISTS qr_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id),

        qr_token VARCHAR(500) UNIQUE NOT NULL,
        qr_data JSONB NOT NULL,
        secure_hash VARCHAR(500) NOT NULL,

        status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',

        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        scanned_by UUID REFERENCES users(id),

        CHECK (status IN ('ACTIVE', 'USED', 'EXPIRED', 'REJECTED'))
      );

      CREATE INDEX IF NOT EXISTS idx_qr_token ON qr_codes(qr_token);
      CREATE INDEX IF NOT EXISTS idx_qr_order ON qr_codes(order_id);
      CREATE INDEX IF NOT EXISTS idx_qr_status ON qr_codes(status);
      CREATE INDEX IF NOT EXISTS idx_qr_expires ON qr_codes(expires_at) WHERE status = 'ACTIVE';
    `);

    // ==========================================
    // 6. PAYMENTS table
    // ==========================================
    await query(`
      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id),

        amount DECIMAL(12, 2) NOT NULL,
        payment_method VARCHAR(50) NOT NULL,
        payment_gateway VARCHAR(100),
        gateway_transaction_id VARCHAR(255),

        status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        status_reason TEXT,

        attempt_count INT DEFAULT 1,
        max_attempts INT DEFAULT 3,

        metadata JSONB,

        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CHECK (payment_method IN ('UPI', 'CARD', 'CASH', 'NET')),
        CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED'))
      );

      CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
      CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
      CREATE INDEX IF NOT EXISTS idx_payments_gateway ON payments(gateway_transaction_id);
      CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
      CREATE INDEX IF NOT EXISTS idx_payments_order_date ON payments(order_id, created_at DESC);
    `);

    // ==========================================
    // 7. INVENTORY table
    // ==========================================
    await query(`
      CREATE TABLE IF NOT EXISTS inventory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,

        opening_stock INT NOT NULL DEFAULT 0,
        current_stock INT NOT NULL DEFAULT 0,
        minimum_threshold INT DEFAULT 10,
        consumed_today INT DEFAULT 0,

        last_restock_date DATE,
        expiry_date DATE,

        status VARCHAR(50) DEFAULT 'NORMAL',

        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by UUID REFERENCES users(id),

        CHECK (status IN ('NORMAL', 'LOW', 'OUT_OF_STOCK', 'EXPIRED'))
      );

      CREATE INDEX IF NOT EXISTS idx_inventory_menu_item ON inventory(menu_item_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_status ON inventory(status);
      CREATE INDEX IF NOT EXISTS idx_inventory_low_stock ON inventory(status) WHERE status IN ('LOW', 'OUT_OF_STOCK');
    `);

    // ==========================================
    // 8. AUDIT_LOGS table
    // ==========================================
    await query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        entity_type VARCHAR(50) NOT NULL,
        entity_id UUID,
        action VARCHAR(50) NOT NULL,

        user_id UUID REFERENCES users(id),
        ip_address INET,

        old_values JSONB,
        new_values JSONB,
        changes_summary TEXT,

        status VARCHAR(50) DEFAULT 'SUCCESS',
        error_message TEXT,

        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'READ', 'CUSTOM')),
        CHECK (status IN ('SUCCESS', 'FAILURE', 'PARTIAL'))
      );

      CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
    `);

    // ==========================================
    // 9. SYSTEM_SETTINGS table
    // ==========================================
    await query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        key VARCHAR(100) UNIQUE NOT NULL,
        value JSONB NOT NULL,
        data_type VARCHAR(50),
        description TEXT,

        is_maintenance_mode BOOLEAN DEFAULT FALSE,
        accepting_orders BOOLEAN DEFAULT TRUE,
        announcement TEXT,

        tax_rate DECIMAL(5, 2) DEFAULT 5.0,
        min_order_value DECIMAL(10, 2) DEFAULT 20.0,
        max_order_value DECIMAL(10, 2) DEFAULT 10000.0,
        peak_hour_threshold INT DEFAULT 50,
        auto_settlement_enabled BOOLEAN DEFAULT TRUE,
        qr_expiry_minutes INT DEFAULT 30,

        created_by UUID REFERENCES users(id),
        updated_by UUID REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_settings_key ON system_settings(key);
    `);

    // ==========================================
    // 10. NOTIFICATIONS table
    // ==========================================
    await query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        type VARCHAR(50) NOT NULL,

        related_entity_type VARCHAR(50),
        related_entity_id UUID,

        is_read BOOLEAN DEFAULT FALSE,
        read_at TIMESTAMP,

        action_url VARCHAR(500),
        image_url VARCHAR(1000),

        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP + INTERVAL '30 days',

        CHECK (type IN ('ORDER_UPDATE', 'PAYMENT', 'PROMOTION', 'ADMIN', 'SYSTEM'))
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
      CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
    `);

    // ==========================================
    // 11. DAILY_REPORTS table
    // ==========================================
    await query(`
      CREATE TABLE IF NOT EXISTS daily_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        report_date DATE NOT NULL UNIQUE,

        total_orders INT DEFAULT 0,
        total_revenue DECIMAL(15, 2) DEFAULT 0,
        successful_payments INT DEFAULT 0,
        failed_payments INT DEFAULT 0,

        revenue_by_method JSONB,
        revenue_by_hour JSONB,

        peak_hour_time TIME,
        peak_hour_orders INT,

        avg_order_value DECIMAL(10, 2),
        repeat_customers INT,
        new_customers INT,

        top_items JSONB,
        low_stock_items JSONB,
        cancelled_orders INT,
        rejected_orders INT,

        generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        generated_by UUID REFERENCES users(id)
      );

      CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports(report_date);
    `);

    // ==========================================
    // Full-text Search Index
    // ==========================================
    await query(`
      CREATE INDEX IF NOT EXISTS idx_menu_search
      ON menu_items USING GIN (to_tsvector('english', name || ' ' || COALESCE(description, '')));
    `);

    // ==========================================
    // Seed default system settings
    // ==========================================
    await query(`
      INSERT INTO system_settings (id, key, value, description, tax_rate, min_order_value, max_order_value, qr_expiry_minutes)
      VALUES (
        gen_random_uuid(),
        'global',
        '{"version": "1.0.0"}'::jsonb,
        'Global system settings',
        5.0, 20.0, 10000.0, 30
      )
      ON CONFLICT (key) DO NOTHING;
    `);

    console.log('✅ All tables and indexes created successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

export async function down(): Promise<void> {
  try {
    await query('DROP TABLE IF EXISTS daily_reports CASCADE');
    await query('DROP TABLE IF EXISTS notifications CASCADE');
    await query('DROP TABLE IF EXISTS system_settings CASCADE');
    await query('DROP TABLE IF EXISTS audit_logs CASCADE');
    await query('DROP TABLE IF EXISTS inventory CASCADE');
    await query('DROP TABLE IF EXISTS payments CASCADE');
    await query('DROP TABLE IF EXISTS qr_codes CASCADE');
    await query('DROP TABLE IF EXISTS order_items CASCADE');
    await query('DROP TABLE IF EXISTS orders CASCADE');
    await query('DROP TABLE IF EXISTS menu_items CASCADE');
    await query('DROP TABLE IF EXISTS users CASCADE');

    console.log('✅ All tables dropped');
  } catch (error) {
    console.error('❌ Rollback failed:', error);
    throw error;
  }
}

// Run migration directly
if (require.main === module) {
  up()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
