/**
 * Canonical unit_type values — single source for Zod + API (matches Prisma enum `UnitType`).
 */
export const UNIT_TYPE_VALUES = [
  'unit',
  'gram',
  'kilogram',
  'millilitre',
  'litre',
  'meter',
  'piece',
  'pair',
  'dozen',
] as const;

export type UnitTypeValue = (typeof UNIT_TYPE_VALUES)[number];

/** UI labels (e.g. admin / mobile pickers). */
export const UNIT_TYPE_OPTIONS: ReadonlyArray<{
  readonly value: UnitTypeValue;
  readonly label: string;
}> = [
  { value: 'unit', label: 'Unit' },
  { value: 'gram', label: 'Gram' },
  { value: 'kilogram', label: 'Kilogram' },
  { value: 'millilitre', label: 'Millilitre' },
  { value: 'litre', label: 'Litre' },
  { value: 'meter', label: 'Meter' },
  { value: 'piece', label: 'Piece' },
  { value: 'pair', label: 'Pair' },
  { value: 'dozen', label: 'Dozen' },
];

const ALLOWED = new Set<string>(UNIT_TYPE_VALUES);

/** Legacy / alias inputs from older APIs or spreadsheets → canonical enum value. */
function aliasToCanonical(raw: string): string {
  const s = raw.trim().toLowerCase();
  const aliases: Record<string, string> = {
    kg: 'kilogram',
    g: 'gram',
    ml: 'millilitre',
    l: 'litre',
    m: 'meter',
    metre: 'meter',
  };
  return aliases[s] ?? s;
}

/**
 * Trim + lowercase string input; map legacy aliases. Non-strings are passed through so Zod can surface a type error.
 */
export function normalizeUnitTypeInput(v: unknown): unknown {
  if (v == null || v === '') return undefined;
  if (typeof v !== 'string') return v;
  const canonical = aliasToCanonical(v);
  if (canonical === '') return undefined;
  return ALLOWED.has(canonical) ? canonical : canonical;
}
