import type { Request, Response, NextFunction } from 'express';
import * as announcementService from '../../service/cms/announcement.service';
import { ApiResponse } from '../../lib/response';

/**
 * Controller for handling Announcement Bar related requests.
 * Handles only req/res logic, delegating business logic to the service layer.
 */

export const createAnnouncement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text, contactPhone, contactEmail, isPublished, startAt, endAt } = req.body;

    const payload: Parameters<typeof announcementService.createAnnouncementService>[0] = {
      text,
      isPublished: isPublished === 'true' || isPublished === true,
    };

    if (contactPhone) payload.contactPhone = contactPhone;
    if (contactEmail) payload.contactEmail = contactEmail;
    if (startAt) payload.startAt = new Date(startAt);
    if (endAt) payload.endAt = new Date(endAt);

    const announcement = await announcementService.createAnnouncementService(payload);

    return ApiResponse.created(res, 'Announcement created successfully', announcement);
  } catch (error) {
    next(error);
  }
};

export const getAllAnnouncements = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const announcements = await announcementService.getAllAnnouncementsService();
    return ApiResponse.success(res, 'Announcements fetched successfully', announcements);
  } catch (error) {
    next(error);
  }
};

export const updateAnnouncement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const { text, contactPhone, contactEmail, isPublished, startAt, endAt } = req.body;

    const payload: any = {};
    if (text !== undefined) payload.text = text;
    if (contactPhone !== undefined) payload.contactPhone = contactPhone || null;
    if (contactEmail !== undefined) payload.contactEmail = contactEmail || null;
    if (isPublished !== undefined)
      payload.isPublished = isPublished === 'true' || isPublished === true;
    if (startAt !== undefined) payload.startAt = startAt ? new Date(startAt) : null;
    if (endAt !== undefined) payload.endAt = endAt ? new Date(endAt) : null;

    const updated = await announcementService.updateAnnouncementService(id, payload);
    return ApiResponse.success(res, 'Announcement updated successfully', updated);
  } catch (error) {
    next(error);
  }
};

export const deleteAnnouncement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    await announcementService.deleteAnnouncementService(id);
    return ApiResponse.success(res, 'Announcement deleted successfully');
  } catch (error) {
    next(error);
  }
};

export const toggleAnnouncement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const updated = await announcementService.toggleAnnouncementService(id);
    return ApiResponse.success(res, 'Announcement status toggled successfully', updated);
  } catch (error) {
    next(error);
  }
};

export const getActiveAnnouncements = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const announcements = await announcementService.getActiveAnnouncementsService();
    return ApiResponse.success(res, 'Active announcements fetched successfully', announcements);
  } catch (error) {
    next(error);
  }
};
