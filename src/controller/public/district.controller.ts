import type { Request, Response } from 'express';
import { ApiResponse } from '~/lib/response';
import { districtService } from '~/service/district/district.service';

export const listDistricts = async (req: Request, res: Response) => {
  try {
    const districts = await districtService.getDistrictsWithCounts();
    console.log('districts: ', districts);
    return ApiResponse.success(res, 'Districts fetched successfully', districts);
  } catch (error) {
    return ApiResponse.serverError(res, 'Error fetching districts', error);
  }
};
