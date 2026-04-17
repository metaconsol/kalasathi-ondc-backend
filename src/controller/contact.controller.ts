// controllers/contact.controller.ts

import { PrismaClient } from '@prisma/client';
export const createContact = async (req, res) => {
  try {
    const { fullName, email, orderNumber, topic, message } = req.body;

    const data = await prisma.contactMessage.create({
      data: {
        fullName,
        email,
        orderNumber,
        topic,
        message,
      },
    });

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ message: 'Something went wrong' });
  }
};
