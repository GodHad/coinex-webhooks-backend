import express from 'express';

const router = express.Router();

router.post('/create', async (req, res) => {
    try {
        
    } catch (error) {
        console.error("Error during creating hook:", error);
        return res.status(500).json({ message: 'Server error' });
    }
});


export default router;
