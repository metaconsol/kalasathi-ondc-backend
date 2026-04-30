import { sqlExec, sqlQuery } from '~/lib/sql';

export const createAnnouncementService = async (data: {
  text: string;
  contactPhone?: string;
  contactEmail?: string;
  isPublished?: boolean;
  startAt?: Date;
  endAt?: Date;
}) => {
  const res = await sqlExec(
    'INSERT INTO `Announcement` (`text`, `contactPhone`, `contactEmail`, `isPublished`, `startAt`, `endAt`) VALUES (?, ?, ?, ?, ?, ?)',
    [
      data.text,
      data.contactPhone ?? null,
      data.contactEmail ?? null,
      data.isPublished ?? false,
      data.startAt ?? null,
      data.endAt ?? null,
    ],
  );
  const rows = await sqlQuery('SELECT * FROM `Announcement` WHERE `id` = ? LIMIT 1', [
    Number(res.insertId),
  ]);
  return rows[0] ?? null;
};

export const getAllAnnouncementsService = async () => {
  return sqlQuery(
    'SELECT * FROM `Announcement` WHERE `deletedAt` IS NULL ORDER BY `createdAt` DESC',
  );
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
  const patch = {
    text: data.text ?? undefined,
    contactPhone: data.contactPhone ?? undefined,
    contactEmail: data.contactEmail ?? undefined,
    isPublished: data.isPublished ?? undefined,
    startAt: data.startAt ?? undefined,
    endAt: data.endAt ?? undefined,
  } as const;

  const fields: string[] = [];
  const values: any[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) {
      fields.push(`\`${k}\` = ?`);
      values.push(v);
    }
  }
  if (fields.length === 0) {
    const rows = await sqlQuery('SELECT * FROM `Announcement` WHERE `id` = ? LIMIT 1', [id]);
    return rows[0] ?? null;
  }
  await sqlExec(`UPDATE \`Announcement\` SET ${fields.join(', ')} WHERE \`id\` = ?`, [
    ...values,
    id,
  ]);
  const rows = await sqlQuery('SELECT * FROM `Announcement` WHERE `id` = ? LIMIT 1', [id]);
  return rows[0] ?? null;
};

export const deleteAnnouncementService = async (id: number) => {
  await sqlExec('UPDATE `Announcement` SET `deletedAt` = NOW() WHERE `id` = ?', [id]);
  const rows = await sqlQuery('SELECT * FROM `Announcement` WHERE `id` = ? LIMIT 1', [id]);
  return rows[0] ?? null;
};

export const toggleAnnouncementService = async (id: number) => {
  const rows = await sqlQuery(
    'SELECT * FROM `Announcement` WHERE `id` = ? AND `deletedAt` IS NULL LIMIT 1',
    [id],
  );
  const announcement = rows[0] ?? null;

  if (!announcement) {
    throw new Error('Announcement not found');
  }

  await sqlExec('UPDATE `Announcement` SET `isPublished` = ? WHERE `id` = ?', [
    !announcement.isPublished,
    id,
  ]);
  const updated = await sqlQuery('SELECT * FROM `Announcement` WHERE `id` = ? LIMIT 1', [id]);
  return updated[0] ?? null;
};

export const getActiveAnnouncementsService = async () => {
  const now = new Date();
  return sqlQuery(
    'SELECT * FROM `Announcement` WHERE `isPublished` = true AND `deletedAt` IS NULL AND (`startAt` IS NULL OR `startAt` <= ?) AND (`endAt` IS NULL OR `endAt` >= ?) ORDER BY `createdAt` DESC',
    [now, now],
  );
};
