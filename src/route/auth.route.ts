import express from 'express';
import { authService } from '~/service/auth/auth.service';

const router = express.Router();

router.post('/register', authService.register);
router.post('/login', authService.login);
router.delete('/logout', authService.logout);

router.post('/otp-verify', authService.otpVerificationForCredentialAccount);

router.get('/user', authService.authenticate, authService.getUser);

export default router;
