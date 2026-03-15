// ============================================================
// Custom Error Classes
// Following BACKEND_DEVELOPMENT_PROMPT.md Section 9
// ============================================================

/**
 * Base application error with HTTP status code and error code.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(statusCode: number, message: string, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code || 'INTERNAL_ERROR';
    this.isOperational = true;
    Object.setPrototypeOf(this, AppError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  public readonly details?: Array<{ field: string; message: string }>;

  constructor(message: string, details?: Array<{ field: string; message: string }>) {
    super(400, message, 'VALIDATION_ERROR');
    this.details = details;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Not authenticated') {
    super(401, message, 'AUTH_ERROR');
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(403, message, 'FORBIDDEN');
    Object.setPrototypeOf(this, AuthorizationError.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, `${resource} not found`, 'NOT_FOUND');
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, 'CONFLICT');
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

export class InsufficientStockError extends AppError {
  constructor(itemName: string) {
    super(422, `Insufficient stock for ${itemName}`, 'INSUFFICIENT_STOCK');
    Object.setPrototypeOf(this, InsufficientStockError.prototype);
  }
}

export class PaymentError extends AppError {
  constructor(message: string) {
    super(402, message, 'PAYMENT_ERROR');
    Object.setPrototypeOf(this, PaymentError.prototype);
  }
}

export class OrderLimitError extends AppError {
  constructor(message: string) {
    super(422, message, 'ORDER_LIMIT_ERROR');
    Object.setPrototypeOf(this, OrderLimitError.prototype);
  }
}
