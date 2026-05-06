import type { Request, Response } from 'express';
import { sqlExec, sqlQuery } from '~/lib/sql';
import { ApiResponse } from '~/lib/response';

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
     FROM user u 
     LEFT JOIN profile p ON p.userId = u.id 
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
    'UPDATE user SET name = COALESCE(?, name), email = COALESCE(?, email) WHERE id = ?',
    [fullName || null, email || null, userId],
  );

  const [updatedUser] = await sqlQuery<any>('SELECT * FROM user WHERE id = ?', [userId]);

  return ApiResponse.success(res, 'Profile updated successfully', updatedUser);
};
