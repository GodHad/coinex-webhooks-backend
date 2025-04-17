import express from 'express';

const router = express.Router();

router.post('/callback', (req, res) => {
    try {
        console.log(req.body);
        return res.status(200).json({message: 'success'});
    } catch (error) {
        console.error(error);
        return res.status(400).json({message: 'Hey I got error'});
    }
});

export default router;