import { Router } from 'express';
import Home from '../models/Home.js';

const router = Router();
 
// The home page route
router.get('/', async (req, res, next) => {
    try {
        const home = await Home.find().sort({_id: 1 });

        console.log('Fetched Home:', home);
        console.log('Number of Home:', home.length);
        
        res.render('index', { 
            title: 'StellaView', 
            description: 'Find the clearest skies with StellaView, an AI powered algorithm that scans cloud cover, moon brightness, temperature, air pollution, and ground vegetation to help you find the best locations for stargazing!',
            content: 'stargazing, night, night sky, dark sky, light pollution, stargazing sites, AI, Algorithm, telescope, photography, night photography, star trails, bortle, stella, stellaview, stella view, bortle scale, cloud cover, astronomical seeing, milky way, celestial events, predictive analytics, light pollution map, dark sky finder, star chart, astrophotography, predictive algorithm, leaflet maps',
            styles: [
                `<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />`
            ],
            scripts: [
                '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>',
                '<script src="https://cdn.jsdelivr.net/npm/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>',
                '<script src="/js/main.js" type="module"></script>',
                '<script src="/js/map.js" type="module"></script>'
            ]
        });
    } catch (err) {
        console.error('Error fetching home data:', err);
        next(err);
    }
});

export default router;