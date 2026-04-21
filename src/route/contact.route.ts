import express from 'express';
import { createContact } from '../controller/contact.controller';

const router = express.Router();

// router.post("/contact", createContact);
router.post('/', createContact);

export default router;
