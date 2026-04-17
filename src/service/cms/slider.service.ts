import { PrismaClient } from '../../generated/prisma/client';

const prisma = new PrismaClient();

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
  return await prisma.cmsSlider.create({
    data: {
      image: data.image ?? null,
      imageMobile: data.imageMobile ?? null,
      imageUrl: data.imageUrl ?? null,

      heading: data.heading,
      subheading: data.subheading ?? null,

      buttonText: data.buttonText ?? null,
      buttonRedirect: data.buttonRedirect ?? null,

      sortOrder: data.sortOrder ?? 0,
      isActive: data.isActive ?? true,
    },
  });
};

// GET ALL (with filter + sorting)
export const getSliders = async (onlyActive = false) => {
  return await prisma.cmsSlider.findMany({
    where: {
      ...(onlyActive ? { isActive: true } : {}),
      deletedAt: null, // 👈 important
    },
    orderBy: {
      sortOrder: 'asc', // 👈 UI ke liye important
    },
  });
};

// UPDATE
export const updateSlider = async (id: number, data: any) => {
  return await prisma.cmsSlider.update({
    where: { id },
    data,
  });
};

// DELETE (soft delete)
export const deleteSlider = async (id: number) => {
  return await prisma.cmsSlider.update({
    where: { id },
    data: {
      deletedAt: new Date(), // 👈 soft delete
    },
  });
};

// TOGGLE ACTIVE
export const toggleSlider = async (id: number, isActive: boolean) => {
  return await prisma.cmsSlider.update({
    where: { id },
    data: { isActive },
  });
};
