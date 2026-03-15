import { Router } from 'express';
import { menuController } from '../controllers/menu.controller';
import { authMiddleware, requireRole } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { createMenuItemSchema, updateMenuItemSchema } from '../middleware/validation';

const router = Router();

// Public routes (anyone can see the menu)
router.get('/', menuController.getMenu);
router.get('/categories', menuController.getCategories);
router.get('/search', menuController.searchItems);
router.get('/:id', menuController.getMenuItem);

// Protected routes (Admin only for modifications)
router.use(authMiddleware);

router.post(
  '/', 
  requireRole('admin'), 
  validateBody(createMenuItemSchema), 
  menuController.createMenuItem
);

router.patch(
  '/:id', 
  requireRole('admin'), 
  validateBody(updateMenuItemSchema), 
  menuController.updateMenuItem
);

router.delete(
  '/:id', 
  requireRole('admin'), 
  menuController.deleteMenuItem
);

export default router;
