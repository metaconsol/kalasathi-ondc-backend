import type { Request, Response, NextFunction } from 'express';
import * as addressService from '~/service/address.service';
import { ApiResponse } from '~/lib/response';

export const createAddress = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const address = await addressService.createAddress(userId, req.body);
    return ApiResponse.created(res, 'Address created successfully', address);
  } catch (error) {
    next(error);
  }
};

export const listAddresses = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const addresses = await addressService.listAddresses(userId);
    return ApiResponse.success(res, 'Addresses fetched successfully', addresses);
  } catch (error) {
    next(error);
  }
};

export const updateAddress = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const { id } = req.params;
    const address = await addressService.updateAddress(Number(id), userId, req.body);
    return ApiResponse.success(res, 'Address updated successfully', address);
  } catch (error) {
    next(error);
  }
};

export const deleteAddress = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const { id } = req.params;
    await addressService.deleteAddress(Number(id), userId);
    return ApiResponse.success(res, 'Address deleted successfully');
  } catch (error) {
    next(error);
  }
};

export const setDefaultAddress = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user.id;
    const { id } = req.params;
    const address = await addressService.setDefaultAddress(Number(id), userId);
    return ApiResponse.success(res, 'Default address set successfully', address);
  } catch (error) {
    next(error);
  }
};
