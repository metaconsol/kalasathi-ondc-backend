import type { BecknError } from '~/ondc/types/beckn.types';
import { ONDC_ERROR } from '~/ondc/config/constants';
import { ondcLogger } from './logger.util';

/** Typed ONDC error that carries a BecknError payload */
export class OndcError extends Error {
  public readonly becknError: BecknError;
  public readonly statusCode: number;

  constructor(becknError: BecknError, message?: string, statusCode = 400) {
    super(message ?? becknError.message ?? becknError.code);
    this.name = 'OndcError';
    this.becknError = becknError;
    this.statusCode = statusCode;
  }

  static invalidRequest(message?: string): OndcError {
    return new OndcError(
      { ...ONDC_ERROR.INVALID_REQUEST, ...(message !== undefined ? { message } : {}) },
      message,
    );
  }

  static invalidSignature(): OndcError {
    return new OndcError(
      { ...ONDC_ERROR.INVALID_SIGNATURE, message: 'Signature verification failed' },
      'Invalid signature',
      401,
    );
  }

  static subscriberNotFound(subscriberId: string): OndcError {
    return new OndcError(
      { ...ONDC_ERROR.SUBSCRIBER_NOT_FOUND, message: `Subscriber not found: ${subscriberId}` },
      'Subscriber not found',
      404,
    );
  }

  static itemNotFound(itemId: string): OndcError {
    return new OndcError(
      { ...ONDC_ERROR.ITEM_NOT_FOUND, message: `Item not found: ${itemId}` },
      'Item not found',
      404,
    );
  }

  static outOfStock(itemId: string): OndcError {
    return new OndcError(
      { ...ONDC_ERROR.ITEM_OUT_OF_STOCK, message: `Item out of stock: ${itemId}` },
      'Out of stock',
      409,
    );
  }

  static orderNotFound(orderId: string): OndcError {
    return new OndcError(
      { ...ONDC_ERROR.ORDER_NOT_FOUND, message: `Order not found: ${orderId}` },
      'Order not found',
      404,
    );
  }
}

/** Log an unexpected ONDC error (non-OndcError) and return a generic BecknError */
export function handleUnexpected(err: unknown, context = ''): BecknError {
  ondcLogger.error('Unexpected ONDC error', { context, error: err });
  return {
    type: 'CORE-ERROR',
    code: '20000',
    message: 'Internal server error',
  };
}
