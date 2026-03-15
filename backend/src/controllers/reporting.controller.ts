import { Response, NextFunction } from 'express';
import { reportingService } from '../services/reporting.service';
import { sendSuccess } from '../utils/response';
import { AuthRequest } from '../types';

export class ReportingController {
  /**
   * GET /api/v1/reports/daily
   */
  async getDailyReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { date } = req.query;
      const today = new Date().toISOString().split('T')[0];
      const reportDate = (date as string) || today;
      
      const report = await reportingService.getDailySummary(reportDate);
      sendSuccess(res, 200, { data: report });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/reports/revenue
   */
  async getRevenueReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ success: false, error: { message: 'startDate and endDate are required' } });
        return;
      }
      
      const report = await reportingService.getRevenueReport(startDate as string, endDate as string);
      sendSuccess(res, 200, { data: report });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/reports/export
   */
  async exportReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { startDate, endDate, format } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ success: false, error: { message: 'startDate and endDate are required' } });
        return;
      }

      if (format === 'csv') {
        const csv = await reportingService.exportToCSV(startDate as string, endDate as string);
        res.header('Content-Type', 'text/csv');
        res.attachment(`sales-report-${startDate}-to-${endDate}.csv`);
        res.send(csv);
        return;
      }

      res.status(400).json({ success: false, error: { message: 'Invalid format. Use format=csv' } });
    } catch (error) {
      next(error);
    }
  }
}

export const reportingController = new ReportingController();
