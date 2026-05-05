import type { Request, Response, NextFunction } from 'express';
import { sqlQuery } from '~/lib/sql';
import { ApiResponse } from '~/lib/response';

export const getStates = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const states = await sqlQuery<any>('SELECT * FROM states ORDER BY name ASC');
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

    const districts = await sqlQuery<any>(
      'SELECT * FROM districts WHERE stateId = ? ORDER BY name ASC',
      [Number(stateId)],
    );

    return ApiResponse.success(res, 'Districts fetched successfully', districts);
  } catch (error) {
    next(error);
  }
};
