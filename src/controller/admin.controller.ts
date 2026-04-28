import { sqlExec, sqlQuery } from '~/lib/sql';
import { ApiResponse } from '~/lib/response';
import type { Request, Response, NextFunction } from 'express';

export const getMessages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.query as { status?: string };

    const messages = status
      ? await sqlQuery<any>(
          'SELECT * FROM `ContactMessage` WHERE `status` = ? ORDER BY `createdAt` DESC',
          [status],
        )
      : await sqlQuery<any>('SELECT * FROM `ContactMessage` ORDER BY `createdAt` DESC');

    return ApiResponse.success(res, 'Messages fetched', messages);
  } catch (e) {
    next(e);
  }
};

export const updateMessageStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    await sqlExec(
      'UPDATE `ContactMessage` SET `status` = ?, `adminNotes` = ?, `resolvedAt` = ?, `resolvedBy` = ? WHERE `id` = ?',
      [
        status,
        adminNotes ?? null,
        status === 'RESOLVED' ? new Date() : null,
        status === 'RESOLVED' ? (req.user?.id ?? null) : null,
        Number(id),
      ],
    );
    const rows = await sqlQuery<any>('SELECT * FROM `ContactMessage` WHERE `id` = ? LIMIT 1', [
      Number(id),
    ]);
    const updated = rows[0] ?? null;

    return ApiResponse.success(res, 'Message updated', updated);
  } catch (e) {
    next(e);
  }
};
