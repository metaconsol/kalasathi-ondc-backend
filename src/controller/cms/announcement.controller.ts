import type { Request, Response, NextFunction } from 'express';
import * as announcementService from '../../service/cms/announcement.service';
import { ApiResponse } from '../../lib/response';

/**
 * Controller for handling Announcement Bar related requests.
 * Handles only req/res logic, delegating business logic to the service layer.
 */

export const createAnnouncement = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text, isPublished, startAt, endAt } = req.body;
    console.log('--- Announcement Controller Create ---');
    console.log('Incoming data:', JSON.stringify(req.body, null, 2));
    // if (!text || text.trim().length < 5) {
    //   return ApiResponse.badRequest(res, 'Announcement text must be at least 5 characters');
    // }

    // if (startAt && endAt && new Date(startAt) > new Date(endAt)) {
    //   return ApiResponse.badRequest(res, 'Start date cannot be greater than end date');
    // }

    const announcement = await announcementService.createAnnouncementService({
      text,
      isPublished,
      startAt,
      endAt,
    });

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
    const updated = await announcementService.updateAnnouncementService(id, req.body);
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
