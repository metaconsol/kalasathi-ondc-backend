import { sqlExec, sqlQuery } from '~/lib/sql';

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

/**
 * Create Review
 */
// export const createReview = async (data: {
//   productId: number;
//   userId: number;
//   rating: number;
//   reviewText?: string;
//   reviewImage?: string;
// }) => {
//   // check product exist
//   const product = await sqlQuery('SELECT id FROM products WHERE id = ? LIMIT 1', [data.productId]);

//   if (!product.length) {
//     throw new Error('Product not found');
//   }

//   // prevent duplicate review
//   const existing = await sqlQuery(
//     'SELECT id FROM product_reviews WHERE product_id = ? AND user_id = ? LIMIT 1',
//     [data.productId, data.userId],
//   );

//   if (existing.length) {
//     throw new Error('You already reviewed this product');
//   }

//   const res = await sqlExec(
//     `INSERT INTO product_reviews
//     (product_id, user_id, rating, review_text, review_image, status)
//     VALUES (?, ?, ?, ?, ?, ?)`,
//     [
//       data.productId,
//       data.userId,
//       data.rating,
//       data.reviewText ?? null,
//       data.reviewImage ?? null,
//       'pending',
//     ],
//   );

//   const rows = await sqlQuery('SELECT * FROM product_reviews WHERE id = ? LIMIT 1', [
//     Number(res.insertId),
//   ]);

//   return rows[0] ?? null;
// };

export const createReview = async (data: {
  productId: number;
  userId: number;
  rating: number;
  reviewText?: string;
  reviewImage?: string;
}) => {
  // check product exist
  const product = await sqlQuery('SELECT id FROM products WHERE id = ? LIMIT 1', [data.productId]);

  if (!product.length) {
    throw new Error('Product not found');
  }

  // rating validation
  if (data.rating < 1 || data.rating > 5) {
    throw new Error('Rating must be between 1 and 5');
  }

  // check purchase (recommended)
  const hasPurchased = await sqlQuery(
    `SELECT oi.id
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE oi.product_id = ?
     AND o.user_id = ?
     AND o.order_status = 'delivered'
     LIMIT 1`,
    [data.productId, data.userId],
  );

  // if (!hasPurchased.length) {
  //   throw new Error('You can review only purchased products');
  // }

  // prevent duplicate review
  const existing = await sqlQuery(
    'SELECT id FROM product_reviews WHERE product_id = ? AND user_id = ? LIMIT 1',
    [data.productId, data.userId],
  );

  if (existing.length) {
    throw new Error('You already reviewed this product');
  }

  // insert review
  const res = await sqlExec(
    `INSERT INTO product_reviews
    (product_id, user_id, rating, review_text, review_image, status)
    VALUES (?, ?, ?, ?, ?, 'pending')`,
    [data.productId, data.userId, data.rating, data.reviewText ?? null, data.reviewImage ?? null],
  );

  const rows = await sqlQuery('SELECT * FROM product_reviews WHERE id = ? LIMIT 1', [
    Number(res.insertId),
  ]);

  return rows[0] ?? null;
};

/**
 * Get Product Reviews (approved only)
 */
export const getProductReviews = async (productId: number) => {
  const reviews = await sqlQuery(
    `SELECT 
      pr.*,
      u.name AS user_name
    FROM product_reviews pr
    JOIN user u ON u.id = pr.user_id
    WHERE pr.product_id = ?
    AND pr.status = 'approved'
    ORDER BY pr.created_at DESC`,
    [productId],
  );

  const summary = await sqlQuery(
    `SELECT 
      COUNT(*) AS total_reviews,
      ROUND(AVG(rating), 1) AS average_rating
    FROM product_reviews
    WHERE product_id = ?
    AND status = 'approved'`,
    [productId],
  );

  return {
    reviews,
    summary: summary[0],
  };
};

/**
 * Get Single Review
 */
export const getReviewById = async (id: number) => {
  const rows = await sqlQuery(
    `SELECT 
      pr.*,
      p.product_name,
      u.name AS user_name
    FROM product_reviews pr
    JOIN products p ON p.id = pr.product_id
    JOIN user u ON u.id = pr.user_id
    WHERE pr.id = ?
    LIMIT 1`,
    [id],
  );

  if (!rows.length) {
    throw new Error('Review not found');
  }

  return rows[0];
};

/**
 * Update Review (owner only)
 */
export const updateReview = async (
  id: number,
  userId: number,
  data: {
    rating?: number;
    reviewText?: string;
    reviewImage?: string;
  },
) => {
  const review = await sqlQuery(
    'SELECT id FROM product_reviews WHERE id = ? AND user_id = ? LIMIT 1',
    [id, userId],
  );

  if (!review.length) {
    throw new Error('Review not found or unauthorized');
  }

  await sqlExec(
    `UPDATE product_reviews
     SET
      rating = COALESCE(?, rating),
      review_text = COALESCE(?, review_text),
      review_image = COALESCE(?, review_image),
      status = 'pending'
     WHERE id = ? AND user_id = ?`,
    [data.rating ?? null, data.reviewText ?? null, data.reviewImage ?? null, id, userId],
  );

  const rows = await sqlQuery('SELECT * FROM product_reviews WHERE id = ? LIMIT 1', [id]);

  return rows[0] ?? null;
};

/**
 * Delete Review
 */
export const deleteReview = async (id: number, userId: number) => {
  const res = await sqlExec('DELETE FROM product_reviews WHERE id = ? AND user_id = ?', [
    id,
    userId,
  ]);

  if (!res.affectedRows) {
    throw new Error('Review not found or unauthorized');
  }

  return { id };
};

/**
 * Admin: Get All Reviews
 */
export const getAllReviews = async (status?: ReviewStatus) => {
  if (status) {
    return sqlQuery(
      `SELECT 
        pr.*,
        p.product_name,
        u.name AS user_name
      FROM product_reviews pr
      JOIN products p ON p.id = pr.product_id
      JOIN user u ON u.id = pr.user_id
      WHERE pr.status = ?
      ORDER BY pr.created_at DESC`,
      [status],
    );
  }

  return sqlQuery(
    `SELECT 
      pr.*,
      p.product_name,
      u.name AS user_name
    FROM product_reviews pr
    JOIN products p ON p.id = pr.product_id
    JOIN user u ON u.id = pr.user_id
    ORDER BY pr.created_at DESC`,
  );
};

/**
 * Admin: Update Review Status
 */
export const updateReviewStatuss = async (id: number, status: ReviewStatus) => {
  await sqlExec('UPDATE product_reviews SET status = ? WHERE id = ?', [status, id]);

  const rows = await sqlQuery('SELECT * FROM product_reviews WHERE id = ? LIMIT 1', [id]);

  return rows[0] ?? null;
};

export const updateReviewStatus = async (data: {
  reviewId: number;
  sellerId: number;
  status: 'approved' | 'rejected';
}) => {
  // validate status
  if (!['approved', 'rejected'].includes(data.status)) {
    throw new Error('Invalid status');
  }

  const res: any = await sqlExec(
    `UPDATE product_reviews pr
     JOIN products p ON p.id = pr.product_id
     JOIN stores s ON s.id = p.store_id
     SET pr.status = ?, pr.updated_at = NOW()
     WHERE pr.id = ? 
     AND s.seller_user_id = ?`, // ✅ FIXED HERE
    [data.status, data.reviewId, data.sellerId],
  );

  if (res.affectedRows === 0) {
    throw new Error('Review not found or you are not allowed to update it');
  }

  return {
    review_id: data.reviewId,
    status: data.status,
  };
};

/**
 * Get Logged-in User Reviews
 */
export const getMyReviews = async (userId: number) => {
  return sqlQuery(
    `SELECT 
      pr.*,
      p.product_name,
      p.default_price,
      p.mrp,
      (
        SELECT pi.image_url
        FROM product_images pi
        WHERE pi.product_id = p.id
        ORDER BY pi.sort_order ASC
        LIMIT 1
      ) AS product_image
    FROM product_reviews pr
    JOIN products p ON p.id = pr.product_id
    WHERE pr.user_id = ?
    ORDER BY pr.created_at DESC`,
    [userId],
  );
};
