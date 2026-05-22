import { Router } from 'express';
import * as reviewController from '~/controller/review.controller';
import { authMiddleware } from '~/middleware/auth.middleware';

const reviewRouter = Router();

// 🔹 Create review
reviewRouter.post('/', authMiddleware, reviewController.createReview);

// 🔹 Product approved reviews
reviewRouter.get('/product/:productId', reviewController.getProductReviews);

// ✅ Logged-in user's reviews - MUST be before /:id
reviewRouter.get('/Reviews/me', authMiddleware, reviewController.getMyReviews);

// ✅ Seller route also keep before /:id/status
reviewRouter.patch(
  '/seller/reviews/:review_id/status',
  authMiddleware,
  reviewController.updateReviewStatusBySeller,
);

// 🔹 Get single review
reviewRouter.get('/:id', authMiddleware, reviewController.getReviewById);

// 🔹 Update review
reviewRouter.patch('/:id', authMiddleware, reviewController.updateReview);

// 🔹 Delete review
reviewRouter.delete('/:id', authMiddleware, reviewController.deleteReview);

// 🔹 Admin: get all reviews
reviewRouter.get('/', authMiddleware, reviewController.getAllReviews);

// 🔹 Admin: approve/reject review
reviewRouter.patch('/:id/status', authMiddleware, reviewController.updateReviewStatus);

export { reviewRouter };
