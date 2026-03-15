import { Router } from 'express';
import { paymentController } from '../controllers/payment.controller';
import { authMiddleware } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { initiatePaymentSchema, mockPaymentCallbackSchema } from '../middleware/validation';

const router = Router();

// Protected routes
router.use(authMiddleware);

router.post('/initiate', validateBody(initiatePaymentSchema), paymentController.initiate);

// Mock Webhooks (in production, webhooks shouldn't require standard JWT auth, but signature validation instead)
// For this mock sprint, we keep them simple.
router.post('/mock/success', validateBody(mockPaymentCallbackSchema), paymentController.success);
router.post('/mock/failure', validateBody(mockPaymentCallbackSchema), paymentController.failure);

export default router;
