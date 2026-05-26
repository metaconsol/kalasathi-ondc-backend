/** BAP terms extracted from /search intent.tags and payment field */

import { ondcExec, ondcQuery } from '~/lib/ondcSql';

export interface BapTermsRow {
  id: number;
  bap_id: string;
  bap_uri: string | null;
  unique_uid: string | null;
  static_terms: string | null;
  static_terms_new: string | null;
  bff_percent: string | null;
  created_at: Date;
  updated_at: Date;
}

export const bapTermsModel = {
  async upsert(data: Omit<BapTermsRow, 'id' | 'created_at' | 'updated_at'>): Promise<void> {
    await ondcExec(
      `INSERT INTO bap_terms (bap_id, bap_uri, unique_uid, static_terms, static_terms_new, bff_percent)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         bap_uri        = VALUES(bap_uri),
         unique_uid     = VALUES(unique_uid),
         static_terms     = COALESCE(NULLIF(VALUES(static_terms), ''), static_terms),
         static_terms_new = COALESCE(NULLIF(VALUES(static_terms_new), ''), static_terms_new),
         bff_percent      = COALESCE(NULLIF(VALUES(bff_percent), ''), bff_percent),
         updated_at       = NOW()`,
      [
        data.bap_id,
        data.bap_uri,
        data.unique_uid,
        data.static_terms,
        data.static_terms_new,
        data.bff_percent,
      ],
    );
  },

  async findByBapId(bapId: string): Promise<BapTermsRow | null> {
    const rows = await ondcQuery<BapTermsRow>(`SELECT * FROM bap_terms WHERE bap_id = ? LIMIT 1`, [
      bapId,
    ]);
    return rows[0] ?? null;
  },

  async list(): Promise<BapTermsRow[]> {
    return ondcQuery<BapTermsRow>(`SELECT * FROM bap_terms ORDER BY updated_at DESC`);
  },
};

/** Extract BAP terms from a /search message.intent */
export function extractBapTerms(
  bapId: string,
  bapUri: string,
  uniqueUid: string,
  intent: Record<string, any>,
): Omit<BapTermsRow, 'id' | 'created_at' | 'updated_at'> {
  let staticTerms: string | null = null;
  let staticTermsNew: string | null = null;
  let bffPercent: string | null = null;

  // Extract from intent.tags[]
  const tags: any[] = Array.isArray(intent['tags']) ? intent['tags'] : [];
  for (const tagGroup of tags) {
    const list: any[] = Array.isArray(tagGroup?.list) ? tagGroup.list : [];
    for (const tag of list) {
      const code = String(tag?.code ?? '');
      const value = String(tag?.value ?? '');
      if (code === 'static_terms' && value) staticTerms = value;
      if (code === 'static_terms_new' && value) staticTermsNew = value;
      if ((code === 'buyer_finder_fee_amount' || code === 'buyer_app_finder_fee_amount') && value)
        bffPercent = value;
    }
  }

  // Also extract from intent.payment
  const payment: Record<string, any> = intent['payment'] ?? {};
  if (payment['@ondc/org/buyer_app_finder_fee_amount'])
    bffPercent = String(payment['@ondc/org/buyer_app_finder_fee_amount']);
  if (payment['buyer_app_finder_fee_amount'])
    bffPercent = String(payment['buyer_app_finder_fee_amount']);

  return {
    bap_id: bapId.slice(0, 255),
    bap_uri: bapUri.slice(0, 255),
    unique_uid: uniqueUid.slice(0, 255),
    static_terms: staticTerms,
    static_terms_new: staticTermsNew,
    bff_percent: bffPercent,
  };
}
