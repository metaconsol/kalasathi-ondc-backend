import { db } from '~/lib/db';

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
  console.log('Incoming data:', JSON.stringify(data, null, 2));

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

  console.log('Prisma createData:', JSON.stringify(createData, null, 2));

  return await db.cmsSlider.create({
    data: createData,
  });
};

// GET ALL (with filter + sorting)
export const getSliders = async (onlyActive = false) => {
  return await db.cmsSlider.findMany({
    where: {
      ...(onlyActive ? { isActive: true } : {}),
      deletedAt: null,
    },
    orderBy: {
      sortOrder: 'asc',
    },
  });
};

// UPDATE
export const updateSlider = async (id: number, data: any) => {
  return await db.cmsSlider.update({
    where: { id: BigInt(id) },
    data,
  });
};

// DELETE (soft delete)
export const deleteSlider = async (id: number) => {
  return await db.cmsSlider.update({
    where: { id: BigInt(id) },
    data: {
      deletedAt: new Date(),
    },
  });
};

// TOGGLE ACTIVE
export const toggleSlider = async (id: number, isActive: boolean) => {
  return await db.cmsSlider.update({
    where: { id: BigInt(id) },
    data: { isActive },
  });
};
