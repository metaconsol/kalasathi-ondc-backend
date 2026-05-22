/** Application user roles — source of truth; not tied to Prisma codegen. */
export const UserRole = {
  USER: 'USER',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
  SELLER: 'SELLER',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const USER_ROLE_VALUES = [
  UserRole.USER,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
  UserRole.SELLER,
] as const;
