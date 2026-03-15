import { query } from '../config/database';
import { logger } from '../utils/logger';

export class ReportingService {
  /**
   * Gets daily sales summary.
   */
  async getDailySummary(date: string): Promise<any> {
    const result = await query(
      `SELECT * FROM daily_reports WHERE report_date = $1`,
      [date]
    );

    if (result.rowCount && result.rowCount > 0) {
      return result.rows[0];
    }

    // If report doesn't exist yet, generate a live summary
    return this.generateLiveSummary(date);
  }

  /**
   * Generates a live summary for a date if the daily_report record doesn't exist yet.
   */
  private async generateLiveSummary(date: string): Promise<any> {
    const ordersResult = await query(
      `SELECT 
        COUNT(*) as total_orders,
        SUM(final_amount) as total_revenue,
        COUNT(CASE WHEN payment_status = 'SUCCESS' THEN 1 END) as successful_payments,
        COUNT(CASE WHEN payment_status = 'FAILED' THEN 1 END) as failed_payments,
        COUNT(CASE WHEN order_status = 'CANCELLED' THEN 1 END) as cancelled_orders,
        COUNT(CASE WHEN order_status = 'REJECTED' THEN 1 END) as rejected_orders
       FROM orders 
       WHERE created_at::date = $1`,
      [date]
    );

    const stats = ordersResult.rows[0];

    const revenueByMethodResult = await query(
      `SELECT payment_type, SUM(final_amount) as revenue
       FROM orders
       WHERE created_at::date = $1 AND payment_status = 'SUCCESS'
       GROUP BY payment_type`,
      [date]
    );

    const revenueByMethod = revenueByMethodResult.rows.reduce((acc: any, row: any) => {
      acc[row.payment_type] = parseFloat(row.revenue);
      return acc;
    }, {});

    const topItemsResult = await query(
      `SELECT mi.name, SUM(oi.quantity) as total_quantity, SUM(oi.total_price) as total_revenue
       FROM order_items oi
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       JOIN orders o ON oi.order_id = o.id
       WHERE o.created_at::date = $1 AND o.payment_status = 'SUCCESS'
       GROUP BY mi.name
       ORDER BY total_quantity DESC
       LIMIT 5`,
      [date]
    );

    return {
      report_date: date,
      total_orders: parseInt(stats.total_orders, 10),
      total_revenue: parseFloat(stats.total_revenue || 0),
      successful_payments: parseInt(stats.successful_payments, 10),
      failed_payments: parseInt(stats.failed_payments, 10),
      cancelled_orders: parseInt(stats.cancelled_orders, 10),
      rejected_orders: parseInt(stats.rejected_orders, 10),
      revenue_by_method: revenueByMethod,
      top_items: topItemsResult.rows,
      is_live: true
    };
  }

  /**
   * Gets revenue report for a period.
   */
  async getRevenueReport(startDate: string, endDate: string): Promise<any> {
    const result = await query(
      `SELECT 
        report_date,
        total_orders,
        total_revenue,
        successful_payments
       FROM daily_reports
       WHERE report_date BETWEEN $1 AND $2
       ORDER BY report_date ASC`,
      [startDate, endDate]
    );

    return result.rows;
  }

  /**
   * Exports sales data as CSV content.
   */
  async exportToCSV(startDate: string, endDate: string): Promise<string> {
    const result = await query(
      `SELECT 
        o.id as order_id,
        o.created_at,
        o.final_amount,
        o.payment_type,
        o.order_status,
        u.email as user_email
       FROM orders o
       JOIN users u ON o.user_id = u.id
       WHERE o.created_at::date BETWEEN $1 AND $2
       ORDER BY o.created_at DESC`,
      [startDate, endDate]
    );

    const rows = result.rows;
    if (rows.length === 0) return 'No data available';

    const header = ['Order ID', 'Date', 'Amount', 'Payment Type', 'Status', 'User Email'];
    const csvRows = [header.join(',')];

    for (const row of rows) {
      csvRows.push([
        row.order_id,
        row.created_at.toISOString(),
        row.final_amount,
        row.payment_type,
        row.order_status,
        row.user_email
      ].join(','));
    }

    return csvRows.join('\n');
  }
}

export const reportingService = new ReportingService();
