import bcrypt from 'bcryptjs';
import crypto from 'crypto';

import { Router } from 'express';
import User from '../../models/User.js'; 
const router = Router();

router.post('/register', async (req, res) => {
    try{
        const { firstName, lastName, email, password } = req.body;

        if (!email || !password) return res.status(400).json({ message: "Missing fields" });

        const existingUser = await User.findOne({ "accountInfo.email": email });
        if (existingUser) return res.status(400).json({ message: "Email already in use" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const verification = crypto.randomBytes(32).toString('hex');

        const newUser = new User({
            id: crypto.randomUUID(),
            accountInfo: {
                firstName, 
                lastName,
                email,
                password: hashedPassword,
                accessLevel: email === 'andrewmulert@gmail.com' ? 10 : 1
            },
            preferences: { 
                homeLocation: { lat: null, lon: null, label: null }
            }
        });

        await newUser.save();

        console.log(`Verification Link: /api/user/verify/${verificationToken}`);
        res.status(201).json({ message: "User registered!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
    
});

router.post('/login', async (req, res) => { 
    /* ... logic ... */ 
});

export default router;