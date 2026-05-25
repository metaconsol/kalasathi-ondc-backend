import type { Request, Response, NextFunction } from 'express';
import * as reviewService from '~/service/review.service';
import { ApiResponse } from '~/lib/response';

const allowedStatus = ['pending', 'approved', 'rejected'];

export const createReview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    const { product_id, rating, review_text, review_image } = req.body;

    if (!userId) {
      return ApiResponse.unauthorized(res, 'Unauthorized');
    }

    if (!product_id || !rating) {
      return ApiResponse.badRequest(res, 'Product id and rating are required');
    }

    if (Number(rating) < 1 || Number(rating) > 5) {
      return ApiResponse.badRequest(res, 'Rating must be between 1 and 5');
    }

    const data = await reviewService.createReview({
      productId: Number(product_id),
      userId: Number(userId),
      rating: Number(rating),
      reviewText: review_text,
      reviewImage: review_image,
    });

    return ApiResponse.created(res, 'Review submitted successfully', data);
  } catch (error) {
    next(error);
  }
};

export const getProductReviews = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const productId = Number(req.params.productId);

    const data = await reviewService.getProductReviews(productId);

    return ApiResponse.success(res, 'Product reviews fetched successfully', data);
  } catch (error) {
    next(error);
  }
};

export const getReviewById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);

    const data = await reviewService.getReviewById(id);

    return ApiResponse.success(res, 'Review fetched successfully', data);
  } catch (error) {
    next(error);
  }
};

export const updateReview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    const id = Number(req.params.id);
    const { rating, review_text, review_image } = req.body;

    if (!userId) {
      return ApiResponse.unauthorized(res, 'Unauthorized');
    }

    if (!id || Number.isNaN(id)) {
      return ApiResponse.badRequest(res, 'Invalid review id');
    }

    // handle rating safely
    const ratingValue =
      rating !== undefined && rating !== null && rating !== '' ? Number(rating) : undefined;

    if (ratingValue !== undefined && (ratingValue < 1 || ratingValue > 5)) {
      return ApiResponse.badRequest(res, 'Rating must be between 1 and 5');
    }

    // 🔥 IMPORTANT: build payload dynamically (fix for exactOptionalPropertyTypes)
    const updatePayload: {
      rating?: number;
      reviewText?: string;
      reviewImage?: string;
    } = {};

    if (ratingValue !== undefined) {
      updatePayload.rating = ratingValue;
    }

    if (review_text !== undefined) {
      updatePayload.reviewText = review_text;
    }

    if (review_image !== undefined) {
      updatePayload.reviewImage = review_image;
    }

    const data = await reviewService.updateReview(id, Number(userId), updatePayload);

    return ApiResponse.success(res, 'Review updated successfully', data);
  } catch (error) {
    next(error);
  }
};
export const deleteReview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;
    const id = Number(req.params.id);

    if (!userId) {
      return ApiResponse.unauthorized(res, 'Unauthorized');
    }

    const data = await reviewService.deleteReview(id, Number(userId));

    return ApiResponse.success(res, 'Review deleted successfully', data);
  } catch (error) {
    next(error);
  }
};

export const getAllReviews = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const statusParam = req.query.status as string | undefined;

    const allowedStatus = ['pending', 'approved', 'rejected'];

    const status = allowedStatus.includes(statusParam || '')
      ? (statusParam as 'pending' | 'approved' | 'rejected')
      : undefined;

    const data = await reviewService.getAllReviews(status);

    return ApiResponse.success(res, 'Reviews fetched successfully', data);
  } catch (error) {
    next(error);
  }
};

export const updateReviewStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;

    if (!allowedStatus.includes(status)) {
      return ApiResponse.badRequest(res, 'Invalid review status');
    }

    const data = await reviewService.updateReviewStatuss(id, status);

    return ApiResponse.success(res, 'Review status updated successfully', data);
  } catch (error) {
    next(error);
  }
};

export const updateReviewStatusBySeller = async (req: any, res: any, next: any) => {
  try {
    const sellerId = req.user?.id;
    const { review_id } = req.params;
    const { status } = req.body;

    if (!sellerId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const data = await reviewService.updateReviewStatus({
      reviewId: Number(review_id),
      sellerId: Number(sellerId),
      status,
    });

    return res.json({
      success: true,
      message: `Review ${status} successfully`,
      data,
    });
  } catch (err) {
    next(err);
  }
};

export const getMyReviews = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      return ApiResponse.unauthorized(res, 'Unauthorized');
    }

    const data = await reviewService.getMyReviews(Number(userId));

    return ApiResponse.success(res, 'My reviews fetched successfully', data);
  } catch (error) {
    next(error);
  }
};
