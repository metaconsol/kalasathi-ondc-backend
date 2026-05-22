import type { Request, Response } from 'express';
import { sqlExec, sqlQuery } from '~/lib/sql';
import { ApiResponse } from '~/lib/response';
import { AuthUtil } from '~/service/auth/auth.util';

/**
 * @desc    Get user profile details
 * @route   GET /api/v1/user/profile
 * @access  Private
 */
export const getProfile = async (req: Request, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return ApiResponse.unauthorized(res, 'User not authenticated');
  }

  const [user] = await sqlQuery<any>(
    `SELECT u.*, p.about, p.region 
     FROM \`User\` u 
     LEFT JOIN \`Profile\` p ON p.userId = u.id 
     WHERE u.id = ? LIMIT 1`,
    [userId],
  );

  if (!user) {
    return ApiResponse.notFound(res, 'User not found');
  }

  // Map to the structure expected by the frontend
  const profileData = {
    id: user.id,
    name: user.name,
    email: user.email,
    phoneNumber: user.phoneNumber,
    avatar: user.avatar,
    role: user.role,
    about: user.about,
    region: user.region,
  };

  return ApiResponse.success(res, 'Profile retrieved successfully', profileData);
};

/**
 * @desc    Update user profile details
 * @route   PUT /api/v1/user/profile
 * @access  Private
 */
export const updateProfile = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { firstName, lastName, email, name } = req.body;

  if (!userId) {
    return ApiResponse.unauthorized(res, 'User not authenticated');
  }

  // If frontend sends firstName/lastName separately, join them if needed for user.name
  const fullName =
    name ||
    (firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || undefined);

  await sqlExec(
    'UPDATE `User` SET name = COALESCE(?, name), email = COALESCE(?, email) WHERE id = ?',
    [fullName || null, email || null, userId],
  );

  const [updatedUser] = await sqlQuery<any>('SELECT * FROM `User` WHERE id = ?', [userId]);

  return ApiResponse.success(res, 'Profile updated successfully', updatedUser);
};

/**
 * @desc    Change authenticated user's password
 * @route   PATCH /api/v1/user/password
 * @access  Private
 */
export const changePassword = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { currentPassword, newPassword } = req.body;

  if (!userId) {
    return ApiResponse.unauthorized(res, 'User not authenticated');
  }

  if (!currentPassword || !newPassword) {
    return ApiResponse.badRequest(res, 'Current password and new password are required');
  }

  if (String(newPassword).length < 8) {
    return ApiResponse.badRequest(res, 'New password must be at least 8 characters long');
  }

  const [user] = await sqlQuery<{ id: number; password: string | null }>(
    'SELECT id, password FROM `User` WHERE id = ? LIMIT 1',
    [userId],
  );

  if (!user?.password) {
    return ApiResponse.notFound(res, 'User not found');
  }

  const isCurrentPasswordValid = await AuthUtil.compareHashedPassword(
    String(currentPassword),
    user.password,
  );

  if (!isCurrentPasswordValid) {
    return ApiResponse.unauthorized(res, 'Current password is incorrect');
  }

  const hashedPassword = await AuthUtil.getHashedPassword(String(newPassword));
  await sqlExec('UPDATE `User` SET password = ? WHERE id = ?', [hashedPassword, userId]);

  return ApiResponse.success(res, 'Password changed successfully');
};
