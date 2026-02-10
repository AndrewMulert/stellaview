import { Router } from 'express';
import Home from '../models/Home.js';

const router = Router();
 
// The home page route
router.get('/', async (req, res) => {
    try {
        const home = await Home.find().sort({_id: 1 });

        console.log('Fetched Home:', home);
        console.log('Number of Home:', home.length);
        
        res.render('index', { 
            title: 'StellaView', 
            description: 'An algorithm based site dedicated to helping you find the best days to view the sky'
        });
    } catch {
        console.error('Error fetching about', err);
        nextTick(err);
    }
});

export default router;