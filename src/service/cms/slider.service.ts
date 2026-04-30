import { sqlExec, sqlQuery } from '~/lib/sql';

// CREATE
export const createSlider = async (data: {
  image?: string;
  imageMobile?: string;
  imageUrl?: string;
  heading: string;
  subheading?: string;
  buttonText?: string;
  buttonRedirect?: string;
  sortOrder?: number;
  isActive?: boolean;
}) => {
  const createData = {
    image: data.image ?? null,
    imageMobile: data.imageMobile ?? null,
    imageUrl: data.imageUrl ?? null,

    heading: data.heading,
    subheading: data.subheading ?? null,

    buttonText: data.buttonText ?? null,
    buttonRedirect: data.buttonRedirect ?? null,

    sortOrder: typeof data.sortOrder === 'number' && !isNaN(data.sortOrder) ? data.sortOrder : 0,
    isActive: data.isActive === false ? false : true,
  };

  const res = await sqlExec(
    'INSERT INTO `cmsSlider` (`image`, `imageMobile`, `imageUrl`, `heading`, `subheading`, `buttonText`, `button_redirect`, `sortOrder`, `isActive`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      createData.image,
      createData.imageMobile,
      createData.imageUrl,
      createData.heading,
      createData.subheading,
      createData.buttonText,
      createData.buttonRedirect,
      createData.sortOrder,
      createData.isActive,
    ],
  );
  const rows = await sqlQuery('SELECT * FROM `cmsSlider` WHERE `id` = ? LIMIT 1', [
    BigInt(res.insertId as any),
  ]);
  return rows[0] ?? null;
};

// GET ALL (with filter + sorting)
export const getSliders = async (onlyActive = false) => {
  if (onlyActive) {
    return sqlQuery(
      'SELECT * FROM `cmsSlider` WHERE `deletedAt` IS NULL AND `isActive` = true ORDER BY `sortOrder` ASC',
    );
  }
  return sqlQuery('SELECT * FROM `cmsSlider` WHERE `deletedAt` IS NULL ORDER BY `sortOrder` ASC');
};

// UPDATE
export const updateSlider = async (id: number, data: any) => {
  const allowed = [
    'image',
    'imageMobile',
    'imageUrl',
    'heading',
    'subheading',
    'buttonText',
    'button_redirect',
    'sortOrder',
    'isActive',
    'deletedAt',
    'pageId',
    'imageUploadId',
    'createdBy',
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
    await sqlExec(`UPDATE \`cmsSlider\` SET ${fields.join(', ')} WHERE \`id\` = ?`, [
      ...values,
      BigInt(id),
    ]);
  }
  const rows = await sqlQuery('SELECT * FROM `cmsSlider` WHERE `id` = ? LIMIT 1', [BigInt(id)]);
  return rows[0] ?? null;
};

// DELETE (soft delete)
export const deleteSlider = async (id: number) => {
  await sqlExec('UPDATE `cmsSlider` SET `deletedAt` = NOW() WHERE `id` = ?', [BigInt(id)]);
  const rows = await sqlQuery('SELECT * FROM `cmsSlider` WHERE `id` = ? LIMIT 1', [BigInt(id)]);
  return rows[0] ?? null;
};

// TOGGLE ACTIVE
export const toggleSlider = async (id: number, isActive: boolean) => {
  await sqlExec('UPDATE `cmsSlider` SET `isActive` = ? WHERE `id` = ?', [isActive, BigInt(id)]);
  const rows = await sqlQuery('SELECT * FROM `cmsSlider` WHERE `id` = ? LIMIT 1', [BigInt(id)]);
  return rows[0] ?? null;
};
