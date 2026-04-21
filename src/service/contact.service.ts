import { db } from '~/lib/db';
import {
  ContactMessage_topic as Topic,
  ContactMessage_status as MessageStatus,
} from '~/generated/prisma/enums';

export const createMessage = async (data: {
  fullName: string;
  email: string;
  orderNumber?: string;
  topic: Topic;
  message: string;
}) => {
  return await db.contactMessage.create({
    data,
  });
};

export const getMessages = async (status?: MessageStatus) => {
  return await db.contactMessage.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: 'desc' },
  });
};

export const updateMessageStatus = async (
  id: number,
  data: { status: MessageStatus; adminNotes?: string; resolvedBy?: number },
) => {
  return await db.contactMessage.update({
    where: { id },
    data: {
      ...data,
      ...(data.status === 'RESOLVED' ? { resolvedAt: new Date() } : {}),
    },
  });
};
