import type { NextFunction, Request, Response } from 'express';
import { ApiResponse } from '~/lib/response';
import * as invoiceService from '~/service/invoice.service';

export const downloadSellerInvoice = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sellerId = (req as any).user?.id;
    // const { sellerUnitId } = req.params;
    const sellerUnitId = String(req.params.sellerUnitId);

    if (!sellerId) {
      return ApiResponse.unauthorized(res, 'Seller not authenticated');
    }

    if (!sellerUnitId) {
      return ApiResponse.badRequest(res, 'sellerUnitId is required');
    }

    const invoice = await invoiceService.generateSellerInvoice(sellerId, sellerUnitId);

    return res.redirect(invoice.filePath);
  } catch (error) {
    next(error);
  }
};
