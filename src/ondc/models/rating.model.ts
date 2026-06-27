import { ondcExec, ondcQuery } from '~/lib/ondcSql';
import { ondcLogger } from '~/ondc/utils/logger.util';

export const ratingModel = {
  async upsertRating(params: {
    transaction_id: string;
    order_id: string;
    rating_category: string;
    rated_id: string;
    rating_value: number | null;
    bap_id: string;
    domain: string;
  }): Promise<void> {
    try {
      await ondcExec(
        `INSERT INTO ondc_ratings
           (transaction_id, order_id, rating_category, rated_id, rating_value, bap_id, domain, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           rating_value = VALUES(rating_value),
           updated_at   = NOW()`,
        [
          params.transaction_id,
          params.order_id,
          params.rating_category,
          params.rated_id,
          params.rating_value,
          params.bap_id,
          params.domain,
        ],
      );
    } catch (err) {
      ondcLogger.warn('ondc_ratings table missing or error — rating not persisted', {
        txnId: params.transaction_id,
        err,
      });
    }
  },

  async listRatings(filters: {
    order_id?: string;
    transaction_id?: string;
    rating_category?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: any[]; total: number }> {
    let sql = `SELECT * FROM ondc_ratings WHERE 1=1`;
    let countSql = `SELECT COUNT(*) as total FROM ondc_ratings WHERE 1=1`;
    const params: any[] = [];

    if (filters.order_id) {
      sql += ` AND order_id = ?`;
      countSql += ` AND order_id = ?`;
      params.push(filters.order_id);
    }
    if (filters.transaction_id) {
      sql += ` AND transaction_id = ?`;
      countSql += ` AND transaction_id = ?`;
      params.push(filters.transaction_id);
    }
    if (filters.rating_category) {
      sql += ` AND rating_category = ?`;
      countSql += ` AND rating_category = ?`;
      params.push(filters.rating_category);
    }

    sql += ` ORDER BY created_at DESC`;

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    sql += ` LIMIT ? OFFSET ?`;

    const [rows, countRows] = await Promise.all([
      ondcQuery<any>(sql, [...params, limit, offset]),
      ondcQuery<{ total: number }>(countSql, params),
    ]);

    return { data: rows, total: countRows[0]?.total || 0 };
  },
};
