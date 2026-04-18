import type { Request, Response } from 'express';
import * as announcementService from '../../../service/cms/AnnocementBar/announcement.service';

const sendResponse = (res: Response, status: number, message: string, data?: any) => {
  return res.status(status).json({
    success: true,
    message,
    data,
  });
};

export const createAnnouncement = async (req: Request, res: Response) => {
  try {
    console.log('BODY =>', req.body);
    const { text, isPublished, startAt, endAt } = req.body;

    if (!text || text.trim().length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Announcement text must be at least 5 characters',
      });
    }

    if (startAt && endAt && new Date(startAt) > new Date(endAt)) {
      return res.status(400).json({
        success: false,
        message: 'startAt cannot be greater than endAt',
      });
    }

    const announcement = await announcementService.createAnnouncementService({
      text,
      isPublished,
      startAt,
      endAt,
    });

    return sendResponse(res, 201, 'Announcement created successfully', announcement);
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
};

/*
export const createAnnouncement = async (req: Request, res: Response) => {
  try {
    console.log('🔥 CONTROLLER HIT');
    console.log('BODY =>', req.body);

    // const { text } = req.body;

    // if (!text || text.trim().length < 5) {
    //   console.log('❌ VALIDATION FAILED');
    //   return res.status(400).json({
    //     success: false,
    //     message: 'Announcement text must be at least 5 characters',
    //   });
    // }

    // console.log('✅ VALIDATION PASSED');

    // const announcement = await announcementService.createAnnouncementService({
    //   text,
    // });

    // return res.status(201).json({
    //   success: true,
    //   data: announcement,
    // });

  } catch (error) {
    console.error('🔥 ERROR =>', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

*/
export const getAllAnnouncements = async (_req: Request, res: Response) => {
  try {
    const announcements = await announcementService.getAllAnnouncementsService();

    return sendResponse(res, 200, 'Announcements fetched', announcements);
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const updateAnnouncement = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);

    const updated = await announcementService.updateAnnouncementService(id, req.body);

    return sendResponse(res, 200, 'Announcement updated', updated);
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const deleteAnnouncement = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);

    await announcementService.deleteAnnouncementService(id);

    return sendResponse(res, 200, 'Announcement deleted');
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const toggleAnnouncement = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);

    const updated = await announcementService.toggleAnnouncementService(id);

    return sendResponse(res, 200, 'Status updated', updated);
  } catch (error: any) {
    return res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

export const getActiveAnnouncements = async (_req: Request, res: Response) => {
  try {
    const announcements = await announcementService.getActiveAnnouncementsService();

    return sendResponse(res, 200, 'Active announcements', announcements);
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
