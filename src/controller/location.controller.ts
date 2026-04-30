import type { Request, Response, NextFunction } from 'express';
import { db } from '~/lib/db';
import { ApiResponse } from '~/lib/response';

export const getStates = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const states = await db.state.findMany({
      orderBy: { name: 'asc' },
    });
    return ApiResponse.success(res, 'States fetched successfully', states);
  } catch (error) {
    next(error);
  }
};

export const getDistricts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stateId } = req.query;

    if (!stateId) {
      return ApiResponse.badRequest(res, 'stateId is required');
    }

    const districts = await db.district.findMany({
      where: { stateId: Number(stateId) },
      orderBy: { name: 'asc' },
    });

    return ApiResponse.success(res, 'Districts fetched successfully', districts);
  } catch (error) {
    next(error);
  }
};
