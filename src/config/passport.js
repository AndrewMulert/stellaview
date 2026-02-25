import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';

passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
    try {
        const user = await User.findOne({ "accountInfo.email": email });
        if (!user) return done(null, false, { message: 'Incorrect email.' });

        const isMatch = await bcrypt.compare(password, user.accountInfo.password);
        if (!isMatch) return done(null, false, { message: 'Incorrect password.' });

        return done(null, user);
    } catch (err) {
        return done(err);
    }
}));

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    proxy: true
}, async (accessToken, refreshToken, profile, done) => {
    try {
        let user = await User.findOne({
            $or: [{ "accountInfo.googleId": profile.id}, { "accountInfo.email": profile.emails[0].value }]
        });

        if (user) {
            if (!user.accountInfo.googleId) {
                user.accountInfo.googleId = profile.id;
                await user.save();
            }
            return done(null, user);
        }

        const newUser = new User({
            id: crypto.randomUUID(),
            accountInfo: {
                firstName: profile.name.givenName,
                lastName: profile.name.familyName,
                email: profile.emails[0].value,
                googleId: profile.id,
                accessLevel: 1
            }
        });
        await newUser.save();
        return done(null, newUser);
    } catch (err) {
        return done(err);
    }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    const user = await User.findOne({ id: id });
    done(null, user);
});