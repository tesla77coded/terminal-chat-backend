import { Router } from "express";
import { getMessages, getChats } from "../controllers/messageController";
import { protect } from '../middleware/authMiddleware'

const router = Router();

router.get('/', protect, getChats);
router.get('/:otherUserId', protect, getMessages);

export default router;
