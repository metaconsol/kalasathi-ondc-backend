import { sqlExec, sqlQuery } from '~/lib/sql';

export type Topic = 'GENERAL_INQUIRY' | 'ORDER_STATUS' | 'RETURNS';
export type MessageStatus = 'RESOLVED' | 'UNRESOLVED';

export const createMessage = async (data: {
  fullName: string;
  email: string;
  orderNumber?: string;
  topic: Topic;
  message: string;
}) => {
  const res = await sqlExec(
    'INSERT INTO `ContactMessage` (`fullName`, `email`, `orderNumber`, `topic`, `message`) VALUES (?, ?, ?, ?, ?)',
    [data.fullName, data.email, data.orderNumber ?? null, data.topic, data.message],
  );
  const rows = await sqlQuery('SELECT * FROM `ContactMessage` WHERE `id` = ? LIMIT 1', [
    Number(res.insertId),
  ]);
  return rows[0] ?? null;
};

export const getMessages = async (status?: MessageStatus) => {
  if (status) {
    return sqlQuery('SELECT * FROM `ContactMessage` WHERE `status` = ? ORDER BY `createdAt` DESC', [
      status,
    ]);
  }
  return sqlQuery('SELECT * FROM `ContactMessage` ORDER BY `createdAt` DESC');
};

export const updateMessageStatus = async (
  id: number,
  data: { status: MessageStatus; adminNotes?: string; resolvedBy?: number },
) => {
  await sqlExec(
    'UPDATE `ContactMessage` SET `status` = ?, `adminNotes` = ?, `resolvedBy` = ?, `resolvedAt` = ? WHERE `id` = ?',
    [
      data.status,
      data.adminNotes ?? null,
      data.resolvedBy ?? null,
      data.status === 'RESOLVED' ? new Date() : null,
      id,
    ],
  );
  const rows = await sqlQuery('SELECT * FROM `ContactMessage` WHERE `id` = ? LIMIT 1', [id]);
  return rows[0] ?? null;
};
