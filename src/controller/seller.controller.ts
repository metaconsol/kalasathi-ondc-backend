import type { NextFunction, Request, Response } from 'express';
import { StoreLocationType } from '~/generated/prisma/enums';
import { ApiResponse } from '~/lib/response';
import { authService } from '~/service/auth/auth.service';
import type { LocationBody } from '~/service/seller/seller.service';
import * as sellerService from '~/service/seller/seller.service';

const sellerUserId = (req: Request) => req.user!.id;

export const onboardingStep1Register = (req: Request, res: Response) => {
  return authService.registerSeller(req, res);
};

export const getSellerProfileHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const profile = await sellerService.getSellerProfile(sellerUserId(req));
    return ApiResponse.success(res, 'Seller profile', { profile });
  } catch (e) {
    next(e);
  }
};

export const putSellerProfileHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const profile = await sellerService.upsertSellerProfile(sellerUserId(req), req.body);
    return ApiResponse.success(res, 'Profile updated', { profile });
  } catch (e) {
    next(e);
  }
};

export const getDashboardSummaryHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const summary = await sellerService.getDashboardSummary(sellerUserId(req));
    return ApiResponse.success(res, 'Dashboard summary', summary);
  } catch (e) {
    next(e);
  }
};

export const listStoresHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stores = await sellerService.listStoresForSeller(sellerUserId(req));
    return ApiResponse.success(res, 'Stores', { stores });
  } catch (e) {
    next(e);
  }
};

export const getStoreBySellerUserIdHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const sellerId = Number(req.params.sellerUserId);

    if (!sellerId) {
      return ApiResponse.badRequest(res, 'sellerUserId is required');
    }

    const stores = await sellerService.getStoreBySellerUserId(sellerId);

    return ApiResponse.success(res, 'Stores fetched successfully', {
      stores,
    });
  } catch (e) {
    next(e);
  }
};

export const getStoreByIdHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const storeId = Number(req.params.storeId);

    const store = await sellerService.getStoreById(storeId);

    return ApiResponse.success(res, 'Store fetched successfully', { store });
  } catch (e) {
    next(e);
  }
};

export const createStoreHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const store = await sellerService.createStoreForSeller(sellerUserId(req), req.body);
    return ApiResponse.created(res, 'Store created', { store });
  } catch (e) {
    next(e);
  }
};

export const getStoreHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { storeId } = req.params as unknown as { storeId: bigint };
    const store = await sellerService.getStoreForSeller(storeId, sellerUserId(req), true);
    return ApiResponse.success(res, 'Store', { store });
  } catch (e) {
    next(e);
  }
};

export const updateStoreHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { storeId } = req.params as unknown as { storeId: bigint };
    const store = await sellerService.updateStoreForSeller(storeId, sellerUserId(req), req.body);
    return ApiResponse.success(res, 'Store updated', { store });
  } catch (e) {
    next(e);
  }
};

export const deleteStoreHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { storeId } = req.params as unknown as { storeId: bigint };
    await sellerService.deleteStoreForSeller(storeId, sellerUserId(req));
    return ApiResponse.success(res, 'Store deleted');
  } catch (e) {
    next(e);
  }
};

export const createPickupLocationHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { storeId } = req.params as unknown as { storeId: bigint };
    const location = await sellerService.createLocation(
      storeId,
      sellerUserId(req),
      StoreLocationType.SELF_PICKUP,
      req.body,
    );
    return ApiResponse.created(res, 'Pickup location created', { location });
  } catch (e) {
    next(e);
  }
};

export const createReturnLocationHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { storeId } = req.params as unknown as { storeId: bigint };
    const location = await sellerService.createLocation(
      storeId,
      sellerUserId(req),
      StoreLocationType.RETURN,
      req.body,
    );
    return ApiResponse.created(res, 'Return location created', { location });
  } catch (e) {
    next(e);
  }
};

export const createDeliveryLocationHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { storeId } = req.params as unknown as { storeId: bigint };
    const location = await sellerService.createLocation(
      storeId,
      sellerUserId(req),
      StoreLocationType.DELIVERY,
      req.body,
    );
    return ApiResponse.created(res, 'Delivery location created', { location });
  } catch (e) {
    next(e);
  }
};

export const createBothLocationsHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { storeId } = req.params as unknown as { storeId: bigint };
    const { pickup, return: returnLoc } = req.body as {
      pickup: LocationBody;
      return: LocationBody;
    };
    const locations = await sellerService.createPickupAndReturn(
      storeId,
      sellerUserId(req),
      pickup,
      returnLoc,
    );
    return ApiResponse.created(res, 'Pickup and return locations created', locations);
  } catch (e) {
    next(e);
  }
};

export const onboardingStep2Profile = putSellerProfileHandler;

export const onboardingStep3Store = createStoreHandler;

export const onboardingStep4Pickup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { storeId, ...body } = req.body as LocationBody & { storeId: bigint };
    const location = await sellerService.createLocation(
      storeId,
      sellerUserId(req),
      StoreLocationType.SELF_PICKUP,
      body,
    );
    return ApiResponse.created(res, 'Pickup location added', { location });
  } catch (e) {
    next(e);
  }
};
