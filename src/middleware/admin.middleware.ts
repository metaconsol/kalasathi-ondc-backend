import type { NextFunction, Request, Response } from 'express';
import { authService } from '~/service/auth/auth.service';
import { UserRole } from '~/generated/prisma/enums';

/**
 * Requires the authenticated user to have an admin role.
 * Must be placed AFTER `authMiddleware` in the middleware chain.
 *
 * Usage:
 *   router.delete('/resource', authMiddleware, isAdmin, handler);
 */
export const isAdmin = authService.authorize([UserRole.ADMIN, UserRole.SUPER_ADMIN]);

/**
 * Requires the authenticated user to have the SUPER_ADMIN role.
 */
export const isSuperAdmin = authService.authorize([UserRole.SUPER_ADMIN]);

/**
 * Requires the authenticated user to have the SELLER role.
 */
export const isSeller = authService.authorize([UserRole.SELLER]);

/**
 * Requires the authenticated user to have either ADMIN or SELLER role.
 */
export const isAdminOrSeller = authService.authorize([
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
  UserRole.SELLER,
]);

/**
 * Generic role guard factory — use when you need a custom set of roles.
 *
 * Usage:
 *   router.get('/route', authMiddleware, requireRole([UserRole.ADMIN]), handler);
 */
export const requireRole = (roles: string[]) => authService.authorize(roles);
