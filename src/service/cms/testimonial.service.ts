import { db } from '~/lib/db';

export const createTestimonial = async (data: {
  customerName: string;
  location?: string;
  testimonialText: string;
  rating: number;
  customerPhoto?: string;
  productOrService?: string;
  isPublished?: boolean;
}) => {
  return await db.testimonial.create({
    data: {
      ...data,
      isPublished: data.isPublished ?? false,
    },
  });
};

export const getTestimonials = async (onlyPublished = false) => {
  return await db.testimonial.findMany({
    where: {
      ...(onlyPublished ? { isPublished: true } : {}),
      deletedAt: null,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
};

export const updateTestimonial = async (id: number, data: any) => {
  return await db.testimonial.update({
    where: { id },
    data,
  });
};

export const deleteTestimonial = async (id: number) => {
  return await db.testimonial.update({
    where: { id },
    data: {
      deletedAt: new Date(),
    },
  });
};

export const toggleTestimonial = async (id: number) => {
  const testimonial = await db.testimonial.findUnique({
    where: { id },
  });

  if (!testimonial) throw new Error('Testimonial not found');

  return await db.testimonial.update({
    where: { id },
    data: {
      isPublished: !testimonial.isPublished,
    },
  });
};
