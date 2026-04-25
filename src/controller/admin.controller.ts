import { db } from '~/lib/db';
import { ApiResponse } from '~/lib/response';
import type { Request, Response, NextFunction } from 'express';

export const getMessages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.query as { status?: string };

    const messages = await db.contactMessage.findMany({
      where: status ? { status: status as any } : {},
      orderBy: { createdAt: 'desc' },
    });

    return ApiResponse.success(res, 'Messages fetched', messages);
  } catch (e) {
    next(e);
  }
};

export const updateMessageStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    const updated = await db.contactMessage.update({
      where: { id: Number(id) },
      data: {
        status,
        adminNotes,
        resolvedAt: status === 'RESOLVED' ? new Date() : null,
        resolvedBy: status === 'RESOLVED' ? req.user?.id : null,
      },
    });

    return ApiResponse.success(res, 'Message updated', updated);
  } catch (e) {
    next(e);
  }
};
