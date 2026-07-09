import type { Request, Response } from 'express';
import { ApiResponse } from '~/lib/response';
import { bapTermsModel } from '~/ondc/models/bap_terms.model';

/** GET /api/v1/ondc/admin/bap-terms */
export async function listBapTerms(req: Request, res: Response): Promise<void> {
  const { bap_id, bap_uri, transaction_id } = req.query as Record<string, string | undefined>;
  // Only pass defined filters — exactOptionalPropertyTypes rejects explicit `undefined`.
  const rows = await bapTermsModel.list({
    ...(bap_id ? { bap_id } : {}),
    ...(bap_uri ? { bap_uri } : {}),
    ...(transaction_id ? { transaction_id } : {}),
  });

  const shaped = rows.map((row) => ({
    id: row.id,
    bap_id: row.bap_id,
    bap_uri: row.bap_uri,
    transaction_id: row.unique_uid,
    static_terms: row.static_terms,
    static_terms_new: row.static_terms_new,
    bff_percent: row.bff_percent,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  ApiResponse.success(res, 'BAP terms', shaped, { total: shaped.length });
}
