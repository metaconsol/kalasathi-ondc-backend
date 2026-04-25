import type { Request, Response, NextFunction } from 'express';
import * as testimonialService from '~/service/cms/testimonial.service';
import { ApiResponse } from '~/lib/response';
import fs from 'fs/promises';
import path from 'path';

const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'testimonials');

async function saveFileBuffer(file: any): Promise<string> {
  await fs.mkdir(uploadDir, { recursive: true });
  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
  const filename = uniqueSuffix + path.extname(file.originalname);
  await fs.writeFile(path.join(uploadDir, filename), file.buffer);
  return `/uploads/testimonials/${filename}`;
}

export const createTestimonial = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { customerName, location, testimonialText, rating, productOrService, isPublished } =
      req.body;
    const file = req.file;

    // Validation
    if (!customerName || !testimonialText || rating === undefined) {
      return ApiResponse.badRequest(res, 'customerName, testimonialText, and rating are required');
    }

    const numericRating = Number(rating);
    if (isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
      return ApiResponse.badRequest(res, 'Rating must be a number between 1 and 5');
    }

    let photoPath = null;
    if (file) {
      photoPath = await saveFileBuffer(file);
    }

    const payload: Parameters<typeof testimonialService.createTestimonial>[0] = {
      customerName,
      testimonialText,
      rating: numericRating,
      isPublished: isPublished === 'true' || isPublished === true,
    };

    if (location) payload.location = location;
    if (productOrService) payload.productOrService = productOrService;
    if (photoPath) payload.customerPhoto = photoPath;

    const testimonial = await testimonialService.createTestimonial(payload);

    return ApiResponse.created(res, 'Testimonial created successfully', testimonial);
  } catch (error) {
    next(error);
  }
};

export const getTestimonials = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { published } = req.query;
    const testimonials = await testimonialService.getTestimonials(published === 'true');
    return ApiResponse.success(res, 'Testimonials fetched successfully', testimonials);
  } catch (error) {
    next(error);
  }
};

export const updateTestimonial = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const { customerName, location, testimonialText, rating, productOrService, isPublished } =
      req.body;
    const file = req.file;

    const payload: any = {
      customerName,
      location,
      testimonialText,
      productOrService,
    };

    if (rating !== undefined) {
      const numericRating = Number(rating);
      if (isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
        return ApiResponse.badRequest(res, 'Rating must be between 1 and 5');
      }
      payload.rating = numericRating;
    }

    if (isPublished !== undefined) {
      payload.isPublished = isPublished === 'true' || isPublished === true;
    }

    if (file) {
      payload.customerPhoto = await saveFileBuffer(file);
    }

    const cleanedPayload = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== undefined),
    );

    const updated = await testimonialService.updateTestimonial(id, cleanedPayload);
    return ApiResponse.success(res, 'Testimonial updated successfully', updated);
  } catch (error) {
    next(error);
  }
};

export const deleteTestimonial = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    await testimonialService.deleteTestimonial(id);
    return ApiResponse.success(res, 'Testimonial deleted successfully');
  } catch (error) {
    next(error);
  }
};

export const toggleTestimonial = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const updated = await testimonialService.toggleTestimonial(id);
    return ApiResponse.success(res, 'Testimonial status toggled successfully', updated);
  } catch (error) {
    next(error);
  }
};
