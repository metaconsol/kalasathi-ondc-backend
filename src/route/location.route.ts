import { Router } from 'express';
import * as locationController from '~/controller/location.controller';

const router = Router();

router.get('/states', locationController.getStates);
router.get('/districts', locationController.getDistricts);

export default router;
