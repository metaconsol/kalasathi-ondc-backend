import { db } from '~/lib/db';

export const createAnnouncementService = async (data: {
  text: string;
  isPublished?: boolean;
  startAt?: Date;
  endAt?: Date;
}) => {
  return db.announcement.create({
    data,
  });
};

export const getAllAnnouncementsService = async () => {
  return db.announcement.findMany({
    orderBy: { createdAt: 'desc' },
  });
};

export const updateAnnouncementService = async (
  id: string,
  data: Partial<{
    text: string;
    isPublished: boolean;
    startAt: Date;
    endAt: Date;
  }>,
) => {
  return db.announcement.update({
    where: { id },
    data,
  });
};

export const deleteAnnouncementService = async (id: string) => {
  return db.announcement.delete({
    where: { id },
  });
};

export const toggleAnnouncementService = async (id: string) => {
  const announcement = await db.announcement.findUnique({
    where: { id },
  });

  if (!announcement) {
    throw new Error('Announcement not found');
  }

  return db.announcement.update({
    where: { id },
    data: {
      isPublished: !announcement.isPublished,
    },
  });
};

export const getActiveAnnouncementsService = async () => {
  const now = new Date();

  return db.announcement.findMany({
    where: {
      isPublished: true,
      AND: [
        {
          OR: [{ startAt: null }, { startAt: { lte: now } }],
        },
        {
          OR: [{ endAt: null }, { endAt: { gte: now } }],
        },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
};
