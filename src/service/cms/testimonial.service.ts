import { sqlExec, sqlQuery } from '~/lib/sql';

export const createTestimonial = async (data: {
  customerName: string;
  location?: string;
  testimonialText: string;
  rating: number;
  customerPhoto?: string;
  productOrService?: string;
  isPublished?: boolean;
}) => {
  const res = await sqlExec(
    'INSERT INTO `Testimonial` (`customerName`, `location`, `testimonialText`, `rating`, `customerPhoto`, `productOrService`, `isPublished`) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      data.customerName,
      data.location ?? null,
      data.testimonialText,
      data.rating,
      data.customerPhoto ?? null,
      data.productOrService ?? null,
      data.isPublished ?? false,
    ],
  );
  const rows = await sqlQuery('SELECT * FROM `Testimonial` WHERE `id` = ? LIMIT 1', [
    Number(res.insertId),
  ]);
  return rows[0] ?? null;
};

export const getTestimonials = async (onlyPublished = false) => {
  if (onlyPublished) {
    return sqlQuery(
      'SELECT * FROM `Testimonial` WHERE `deletedAt` IS NULL AND `isPublished` = true ORDER BY `createdAt` DESC',
    );
  }
  return sqlQuery(
    'SELECT * FROM `Testimonial` WHERE `deletedAt` IS NULL ORDER BY `createdAt` DESC',
  );
};

export const updateTestimonial = async (id: number, data: any) => {
  const allowed = [
    'customerName',
    'location',
    'testimonialText',
    'rating',
    'customerPhoto',
    'productOrService',
    'isPublished',
    'deletedAt',
    'updatedAt',
  ];
  const fields: string[] = [];
  const values: any[] = [];
  for (const k of allowed) {
    if (data?.[k] !== undefined) {
      fields.push(`\`${k}\` = ?`);
      values.push(data[k]);
    }
  }
  if (fields.length) {
    await sqlExec(`UPDATE \`Testimonial\` SET ${fields.join(', ')} WHERE \`id\` = ?`, [
      ...values,
      id,
    ]);
  }
  const rows = await sqlQuery('SELECT * FROM `Testimonial` WHERE `id` = ? LIMIT 1', [id]);
  return rows[0] ?? null;
};

export const deleteTestimonial = async (id: number) => {
  await sqlExec('UPDATE `Testimonial` SET `deletedAt` = NOW() WHERE `id` = ?', [id]);
  const rows = await sqlQuery('SELECT * FROM `Testimonial` WHERE `id` = ? LIMIT 1', [id]);
  return rows[0] ?? null;
};

export const toggleTestimonial = async (id: number) => {
  const rows = await sqlQuery('SELECT * FROM `Testimonial` WHERE `id` = ? LIMIT 1', [id]);
  const testimonial = rows[0] ?? null;

  if (!testimonial) throw new Error('Testimonial not found');

  await sqlExec('UPDATE `Testimonial` SET `isPublished` = ? WHERE `id` = ?', [
    !testimonial.isPublished,
    id,
  ]);
  const updated = await sqlQuery('SELECT * FROM `Testimonial` WHERE `id` = ? LIMIT 1', [id]);
  return updated[0] ?? null;
};
