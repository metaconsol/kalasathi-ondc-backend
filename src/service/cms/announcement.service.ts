import { db } from '~/lib/db';

export const createAnnouncementService = async (data: {
  text: string;
  contactPhone?: string;
  contactEmail?: string;
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
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
};

export const updateAnnouncementService = async (
  id: number,
  data: Partial<{
    text: string;
    contactPhone: string | null;
    contactEmail: string | null;
    isPublished: boolean;
    startAt: Date | null;
    endAt: Date | null;
  }>,
) => {
  return db.announcement.update({
    where: { id },
    data,
  });
};

export const deleteAnnouncementService = async (id: number) => {
  return db.announcement.update({
    where: { id },
    data: {
      deletedAt: new Date(),
    },
  });
};

export const toggleAnnouncementService = async (id: number) => {
  const announcement = await db.announcement.findUnique({
    where: { id, deletedAt: null },
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
      deletedAt: null,
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
