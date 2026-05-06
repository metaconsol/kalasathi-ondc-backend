import { Router } from 'express';
import * as ticketController from '~/controller/ticket.controller';
import { authMiddleware } from '~/middleware/auth.middleware';

const ticketRouter = Router();

ticketRouter.post('/', authMiddleware, ticketController.createTicket);

ticketRouter.get('/user/my-tickets', authMiddleware, ticketController.getMyTickets);
ticketRouter.get('/seller/my-tickets', authMiddleware, ticketController.getSellerTickets);
ticketRouter.get('/', authMiddleware, ticketController.getAllTickets);

ticketRouter.get('/:id', authMiddleware, ticketController.getTicketById);
ticketRouter.post('/:id/message', authMiddleware, ticketController.addTicketMessage);
ticketRouter.patch('/:id/status', authMiddleware, ticketController.updateTicketStatus);
ticketRouter.patch('/:id/resolve', authMiddleware, ticketController.resolveTicket);
ticketRouter.patch('/:id/reject', authMiddleware, ticketController.rejectTicket);
ticketRouter.patch('/:id/close', authMiddleware, ticketController.closeTicket);

export { ticketRouter };
