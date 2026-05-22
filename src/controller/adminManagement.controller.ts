import type { Request, Response } from 'express';
import { adminService } from '~/service/admin/admin.service';

export const listAdmins = (req: Request, res: Response) => adminService.listAdmins(req, res);

export const createAdmin = (req: Request, res: Response) => adminService.createAdmin(req, res);

export const assignAdminDistrict = (req: Request, res: Response) =>
  adminService.assignDistrict(req, res);

export const deleteAdmin = (req: Request, res: Response) => adminService.deleteAdmin(req, res);
