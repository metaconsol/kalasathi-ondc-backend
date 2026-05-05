import { Router } from 'express';
import * as reviewController from '~/controller/review.controller';
import { authMiddleware } from '~/middleware/auth.middleware';

const reviewRouter = Router();

// 🔹 Create review (user must be logged in)
reviewRouter.post('/', authMiddleware, reviewController.createReview);

// 🔹 Get all approved reviews of a product
reviewRouter.get('/product/:productId', reviewController.getProductReviews);

// 🔹 Get single review
reviewRouter.get('/:id', authMiddleware, reviewController.getReviewById);

// 🔹 Update review (only owner)
reviewRouter.patch('/:id', authMiddleware, reviewController.updateReview);

// 🔹 Delete review (only owner)
reviewRouter.delete('/:id', authMiddleware, reviewController.deleteReview);

// 🔹 Admin: get all reviews
reviewRouter.get('/', authMiddleware, reviewController.getAllReviews);

// 🔹 Admin: approve/reject review
reviewRouter.patch('/:id/status', authMiddleware, reviewController.updateReviewStatus);

export { reviewRouter };
