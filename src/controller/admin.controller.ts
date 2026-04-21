import { prisma } from '../path/to/your/prisma/client';

export const getMessages = async (req, res) => {
  try {
    const { status } = req.query;

    const messages = await prisma.contactMessage.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
    });

    res.json(messages);
  } catch {
    res.status(500).json({ message: 'Error fetching messages' });
  }
};

export const updateMessageStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    const updated = await prisma.contactMessage.update({
      where: { id: Number(id) },
      data: {
        status,
        adminNotes,
        resolvedAt: status === 'RESOLVED' ? new Date() : null,
        resolvedBy: status === 'RESOLVED' ? req.user.id : null,
      },
    });

    res.json(updated);
  } catch {
    res.status(500).json({ message: 'Update failed' });
  }
};
