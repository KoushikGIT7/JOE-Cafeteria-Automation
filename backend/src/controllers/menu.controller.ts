import { Response, NextFunction, Request } from 'express';
import { menuService } from '../services/menu.service';
import { sendSuccess } from '../utils/response';
import { AuthRequest } from '../types';
import { logger } from '../utils/logger';

console.log('DEBUG: menu.controller.ts loaded. menuService defined:', typeof menuService !== 'undefined');

export class MenuController {
  /**
   * GET /api/v1/menu
   */
  async getMenu(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { categoryId, limit, offset } = req.query;
      const result = await menuService.getMenu(
        categoryId as string | undefined,
        { limit: Number(limit) || 50, offset: Number(offset) || 0 }
      );
      sendSuccess(res, 200, { data: result });
    } catch (error) {
       console.error('Error in MenuController.getMenu:', error);
      next(error);
    }
  }

  /**
   * GET /api/v1/menu/categories
   */
  async getCategories(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const categories = await menuService.getMenuCategories();
      sendSuccess(res, 200, { data: { categories } });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/menu/search?q=query
   */
  async searchItems(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { q } = req.query;
      if (!q || typeof q !== 'string') {
        sendSuccess(res, 200, { data: { items: [] } });
        return;
      }
      const items = await menuService.searchItems(q);
      sendSuccess(res, 200, { data: { items } });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/menu/:id
   */
  async getMenuItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const item = await menuService.getMenuItemById(id);
      sendSuccess(res, 200, { data: { item } });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/menu (Admin)
   */
  async createMenuItem(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = req.body;
      const adminId = req.userId!;
      
      const item = await menuService.createMenuItem({ ...data, created_by: adminId });
      logger.info('Menu item created by admin', { adminId, itemId: item.id });
      
      sendSuccess(res, 201, { data: { item } });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/v1/menu/:id (Admin)
   */
  async updateMenuItem(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const data = req.body;
      const adminId = req.userId!;
      
      const item = await menuService.updateMenuItem(id, { ...data, updated_by: adminId });
      logger.info('Menu item updated by admin', { adminId, itemId: item.id });
      
      sendSuccess(res, 200, { data: { item } });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/menu/:id (Admin)
   */
  async deleteMenuItem(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const adminId = req.userId!;
      
      await menuService.deleteMenuItem(id);
      logger.info('Menu item deleted by admin', { adminId, itemId: id });
      
      sendSuccess(res, 200, { message: 'Menu item discontinued successfully' });
    } catch (error) {
      next(error);
    }
  }
}

export const menuController = new MenuController();
