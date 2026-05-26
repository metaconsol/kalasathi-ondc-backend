/**
 * User Adapter — maps ONDC billing/customer info to ondc_odop_db user lookups.
 * The production DB has the table as `user` (singular) with `phoneNumber`.
 */

import { ondcQuery } from '~/lib/ondcSql';
import type { OndcBilling } from '~/ondc/types/ondc.types';

export interface MainDbUserLookup {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
}

const USER_SELECT = `id, name, email, phoneNumber AS phone`;

export async function findUserByPhone(phone: string): Promise<MainDbUserLookup | null> {
  const rows = await ondcQuery<MainDbUserLookup>(
    `SELECT ${USER_SELECT} FROM \`user\` WHERE phoneNumber = ? LIMIT 1`,
    [phone],
  );
  return rows[0] ?? null;
}

export async function findUserByEmail(email: string): Promise<MainDbUserLookup | null> {
  const rows = await ondcQuery<MainDbUserLookup>(
    `SELECT ${USER_SELECT} FROM \`user\` WHERE email = ? LIMIT 1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function resolveOndcBillingUser(
  billing: OndcBilling,
): Promise<MainDbUserLookup | null> {
  if (billing.phone) {
    const user = await findUserByPhone(billing.phone);
    if (user) return user;
  }
  if (billing.email) {
    const user = await findUserByEmail(billing.email);
    if (user) return user;
  }
  return null;
}
