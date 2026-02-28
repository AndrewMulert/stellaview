import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import passport from 'passport';

import { Router } from 'express';
import User from '../../models/User.js'; 
const router = Router();

router.post('/register', async (req, res) => {
    try{
        const { accountInfo, preferences } = req.body;

        const { firstName, lastName, email, password } = accountInfo || {};

        if (!email || !password) return res.status(400).json({ message: "Missing fields" });

        const existingUser = await User.findOne({ "accountInfo.email": email });
        if (existingUser) return res.status(400).json({ message: "Email already in use" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const verificationToken = crypto.randomBytes(32).toString('hex');

        const newUser = new User({
            id: crypto.randomUUID(),
            accountInfo: {
                firstName, 
                lastName,
                email,
                password: hashedPassword,
                accessLevel: 1,
                isVerified: false,
                verificationToken: verificationToken
            },
            preferences: preferences || { 
                homeLocation: { lat: null, lon: null, label: null }
            }
        });

        await newUser.save();

        console.log(`User created. Verification Token: ${verificationToken}`);

        res.status(201).json({ message: "User registered! Waiting for manual verification." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error during registration" });
    }
    
});

router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/'}), (req, res) => res.redirect('/'));

router.post('/login', passport.authenticate('local'), (req, res) => { 
    res.json({ message: "Welcome back!", user: req.user}) ;
});

router.get('/me', (req, res) => {
    if (req.isAuthenticated()) {
        const userData = req.user.toObject();
        delete userData.accountInfo.password;
        res.json(userData);
    } else {
        res.status(401).json({ message: "Not logged in"});
    }
});

router.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/');
    });
});

router.post('/update-prefs', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).send("Not logged in");
     try {
        const user = await User.findById(req.user._id);
        user.preferences = { ...user.preferences, ...req.body.preferences };
        await user.save();
        res.json({ success: true, preferences: user.preferences });
     } catch (err) {
        res.status(500).json({ error: err.message });
     }
});

export default router;