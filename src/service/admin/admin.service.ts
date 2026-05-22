import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { UserRole, AccountType, AccountProvider, AccountStatus } from '~/generated/prisma/enums';
import { env } from '~/config/env.config';
import { ApiResponse } from '~/lib/response';
import { sqlExec, sqlQuery, withSqlTransaction } from '~/lib/sql';
import { AuthUtil } from '~/service/auth/auth.util';
import { mailServiceAsync } from '~/service/mail/mail.service';

const createAdminSchema = z.object({
  fullName: z.string().trim().min(2).max(80).optional(),
  name: z.string().trim().min(2).max(80).optional(),
  email: z.email().optional(),
  phoneNumber: z.string().trim().min(10).max(15),
  password: z.string().trim().min(8).max(50),
  districtName: z.string().trim().min(2).max(120),
});

const assignDistrictSchema = z.object({
  districtName: z.string().trim().min(2).max(120),
});

function normalizeIndianPhoneNumber(phoneNumber: string) {
  const trimmed = phoneNumber.trim();
  if (trimmed.startsWith('+')) return trimmed;

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  return trimmed;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getAdminLoginUrl() {
  const baseUrl = process.env.CLIENT_1;

  return new URL('/adminlogin', baseUrl).toString();
}

function buildAdminWelcomeEmail(input: {
  name: string;
  password: string;
  role: string;
  loginUrl: string;
  districtName: string;
  mobileNumber: string;
}) {
  const name = escapeHtml(input.name);
  const password = escapeHtml(input.password);
  const role = escapeHtml(input.role);
  const loginUrl = escapeHtml(input.loginUrl);
  const districtName = escapeHtml(input.districtName);
  const mobileNumber = escapeHtml(input.mobileNumber);

  const text = [
    `Hello ${input.name},`,
    '',
    'Your ODOP admin account has been created.',
    `Name: ${input.name}`,
    `Role: ${input.role}`,
    `District: ${input.districtName}`,
    `Mobile: ${input.mobileNumber}`,
    `Password: ${input.password}`,
    `Login link: ${input.loginUrl}`,
    '',
    'Please change your password after login from your profile page.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;color:#3f2a1f;line-height:1.6">
      <h2 style="margin:0 0 12px;color:#790000">Your ODOP admin account is ready</h2>
      <p>Hello ${name},</p>
      <p>Your ODOP admin account has been created. Use the details below to login.</p>
      <table style="border-collapse:collapse;margin:16px 0;min-width:280px">
        <tr><td style="padding:8px 12px;border:1px solid #f0d2a1;font-weight:bold">Name</td><td style="padding:8px 12px;border:1px solid #f0d2a1">${name}</td></tr>
        <tr><td style="padding:8px 12px;border:1px solid #f0d2a1;font-weight:bold">Role</td><td style="padding:8px 12px;border:1px solid #f0d2a1">${role}</td></tr>
        <tr><td style="padding:8px 12px;border:1px solid #f0d2a1;font-weight:bold">District</td><td style="padding:8px 12px;border:1px solid #f0d2a1">${districtName}</td></tr>
        <tr><td style="padding:8px 12px;border:1px solid #f0d2a1;font-weight:bold">Mobile</td><td style="padding:8px 12px;border:1px solid #f0d2a1">${mobileNumber}</td></tr>
        <tr><td style="padding:8px 12px;border:1px solid #f0d2a1;font-weight:bold">Password</td><td style="padding:8px 12px;border:1px solid #f0d2a1">${password}</td></tr>
      </table>
      <p>
        <a href="${loginUrl}" style="display:inline-block;background:#790000;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:bold">Login to Admin Panel</a>
      </p>
      <p style="color:#790000;font-weight:bold">Please change your password after login from your profile page.</p>
    </div>
  `;

  return { text, html };
}

export async function getAssignedDistrictForAdmin(adminId: number) {
  const rows = await sqlQuery<{ name: string }>(
    `SELECT ada.district_name AS name
     FROM admin_district_assignments ada
     WHERE ada.admin_id = ?
     LIMIT 1`,
    [adminId],
  );
  return rows[0] ?? null;
}

export async function canModerateProduct(user: { id: number; role: string }, productId: bigint) {
  if (user.role === UserRole.SUPER_ADMIN) {
    return { ok: true as const };
  }

  if (user.role !== UserRole.ADMIN) {
    return { ok: false as const, status: 403, message: 'Admin access required' };
  }

  const rows = await sqlQuery<{ district: string | null; assignedDistrict: string | null }>(
    `SELECT p.district, ada.district_name AS assignedDistrict
     FROM products p
     LEFT JOIN admin_district_assignments ada ON ada.admin_id = ?
     WHERE p.id = ?
     LIMIT 1`,
    [user.id, productId],
  );
  const product = rows[0] ?? null;
  if (!product) {
    return { ok: false as const, status: 404, message: 'Product not found' };
  }
  if (!product.assignedDistrict) {
    return { ok: false as const, status: 403, message: 'No district assigned to this admin' };
  }

  const productDistrict = String(product.district ?? '')
    .trim()
    .toLowerCase();
  const assignedDistrict = String(product.assignedDistrict).trim().toLowerCase();
  if (productDistrict !== assignedDistrict) {
    return {
      ok: false as const,
      status: 403,
      message: 'You can moderate products only from your assigned district',
    };
  }

  return { ok: true as const };
}

class AdminService {
  public listAdmins = async (_req: Request, res: Response) => {
    try {
      const rows = await sqlQuery(
        `SELECT
           u.id, u.name, u.email, u.phoneNumber, u.role, u.createdAt, u.updatedAt,
           NULL AS districtId, ada.district_name AS districtName,
           NULL AS stateId, NULL AS stateName
         FROM User u
         LEFT JOIN admin_district_assignments ada ON ada.admin_id = u.id
         WHERE u.role = ?
         ORDER BY u.createdAt DESC`,
        [UserRole.ADMIN],
      );

      return ApiResponse.success(res, 'Admins fetched successfully', rows);
    } catch (error) {
      return ApiResponse.serverError(res, 'Error fetching admins', error);
    }
  };

  public createAdmin = async (req: Request, res: Response) => {
    try {
      const parsed = createAdminSchema.safeParse(req.body);
      if (!parsed.success) {
        return ApiResponse.badRequest(res, 'Invalid request body', parsed.error);
      }

      const { email, password, districtName } = parsed.data;
      const phoneNumber = normalizeIndianPhoneNumber(parsed.data.phoneNumber);
      const name = parsed.data.fullName ?? parsed.data.name;
      if (!name) {
        return ApiResponse.badRequest(res, 'name or fullName is required');
      }

      const existing = await sqlQuery<{ id: number }>(
        'SELECT id FROM User WHERE phoneNumber = ? OR email = ? LIMIT 1',
        [phoneNumber, email ?? null],
      );
      if (existing[0]) {
        return ApiResponse.badRequest(res, 'User already exists with this phone number or email');
      }

      const hashedPassword = await AuthUtil.getHashedPassword(password);
      const created = await withSqlTransaction(async (tx) => {
        const userRes = await sqlExec(
          'INSERT INTO User (username, name, email, phoneNumber, password, role) VALUES (?, ?, ?, ?, ?, ?)',
          [randomUUID(), name, email ?? null, phoneNumber, hashedPassword, UserRole.ADMIN],
          tx,
        );
        const adminId = Number(userRes.insertId);
        await sqlExec(
          'INSERT INTO Profile (userId, updatedAt) VALUES (?, ?)',
          [adminId, new Date()],
          tx,
        );
        await sqlExec(
          'INSERT INTO Account (id, userId, type, provider, providerAccountId, status) VALUES (?, ?, ?, ?, ?, ?)',
          [
            randomUUID(),
            adminId,
            AccountType.CREDENTIALS,
            AccountProvider.CREDENTIALS,
            String(adminId),
            AccountStatus.ACTIVE,
          ],
          tx,
        );
        await sqlExec(
          'INSERT INTO admin_district_assignments (admin_id, district_name, assigned_by) VALUES (?, ?, ?)',
          [adminId, districtName, req.user?.id ?? null],
          tx,
        );
        return { adminId };
      });

      if (email) {
        const loginUrl = getAdminLoginUrl();
        const message = buildAdminWelcomeEmail({
          name,
          password,
          role: UserRole.ADMIN,
          loginUrl,
          districtName,
          mobileNumber: phoneNumber,
        });

        void mailServiceAsync({
          to: email,
          subject: 'Your ODOP admin account has been created',
          text: message.text,
          html: message.html,
        });
      }

      return ApiResponse.created(res, 'Admin created successfully', {
        id: created.adminId,
        name,
        email: email ?? null,
        phoneNumber,
        role: UserRole.ADMIN,
        district: { name: districtName },
      });
    } catch (error) {
      return ApiResponse.serverError(res, 'Error creating admin', error);
    }
  };

  public assignDistrict = async (req: Request, res: Response) => {
    try {
      const adminId = Number(req.params.adminId);
      if (!Number.isInteger(adminId) || adminId <= 0) {
        return ApiResponse.badRequest(res, 'Invalid admin id');
      }

      const parsed = assignDistrictSchema.safeParse(req.body);
      if (!parsed.success) {
        return ApiResponse.badRequest(res, 'Invalid request body', parsed.error);
      }

      const adminRows = await sqlQuery<{ id: number; role: string }>(
        'SELECT id, role FROM User WHERE id = ? LIMIT 1',
        [adminId],
      );
      const admin = adminRows[0] ?? null;
      if (!admin || admin.role !== UserRole.ADMIN) {
        return ApiResponse.badRequest(res, 'Target user must be an admin');
      }

      await sqlExec(
        `INSERT INTO admin_district_assignments (admin_id, district_name, assigned_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           district_name = VALUES(district_name),
           assigned_by = VALUES(assigned_by),
           updated_at = CURRENT_TIMESTAMP(3)`,
        [adminId, parsed.data.districtName, req.user?.id ?? null],
      );

      return ApiResponse.success(res, 'Admin district assigned successfully', {
        adminId,
        district: { name: parsed.data.districtName },
      });
    } catch (error) {
      return ApiResponse.serverError(res, 'Error assigning district', error);
    }
  };

  public deleteAdmin = async (req: Request, res: Response) => {
    try {
      const adminId = Number(req.params.adminId);
      if (!Number.isInteger(adminId) || adminId <= 0) {
        return ApiResponse.badRequest(res, 'Invalid admin id');
      }
      if (adminId === req.user?.id) {
        return ApiResponse.badRequest(res, 'You cannot remove your own admin account');
      }

      const result = await sqlExec('DELETE FROM User WHERE id = ? AND role = ?', [
        adminId,
        UserRole.ADMIN,
      ]);
      if (result.affectedRows === 0) {
        return ApiResponse.notFound(res, 'Admin not found');
      }

      return ApiResponse.success(res, 'Admin removed successfully');
    } catch (error) {
      return ApiResponse.serverError(res, 'Error removing admin', error);
    }
  };
}

export const adminService = new AdminService();
