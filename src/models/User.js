import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true
    },
    accountInfo: {
        firstName: {
            type: String,
            required: true,
            trim: true
        },
        lastName: {
            type: String,
            required: true,
            trim: true
        },
        email: {
            type: String,
            required: true
        },
        password: {
            type: String,
            required: true
        },
        createdAt: {
            type: Date,
            default: Date.now
        },
        accessLevel: {
            type: Number,
            default: 1,
            required: true
        },
        isVerified: {
            type: Boolean,
            default: false
        },
        verificationToken: {
            type: String
        },
        googleId: {
            type: String, 
            unique: true,
            sparse: true
        },
        githubId: { 
            type: String,
            unique: true,
            sparse: true
        }
    },
    preferences: {
        maxDriveTime: { 
            type: Number, 
            default: 60
        },
        tempUnit: { 
            type: String, 
            enum: ['celsius', 'fahrenheit'],
            default: 'fahrenheit'
        },
        minTemp: {
            type: Number,
            default: 20
        },
        maxTemp: {
            type: Number,
            default: 95
        },
        maxBortle: {
            type: Number,
            default: 4
        },
        latestSayOut: {
            type: String,
            default: "02:00"
        },
        homeLocation: {
            lat: {
                type: Number,
                default: null
            },
            lon: {
                type: Number,
                default: null
            },
            label: {
                type: String,
                default: null
            }
        }
    },
    savedSites: [{
        osmId: {
            type: String,
            required: true
        },
        name: {
            type: String,
            required: true
        },
        addedAt: {
            type: Date,
            required: true,
            default: Date.now
        }
    }],
    history: [{
        type: String
    }]
},
{collection: 'user'});

userSchema.pre('validate', function(next) {
    const loc = this.preferences.homeLocation;
    const hasAny = loc.lat !== null || loc.lon !== null || loc.label !== null;
    const hasAll = loc.lat !== null && loc.lon !== null && loc.label !== null;

    if(hasAny && !hasAll) {
        next(new Error('homeLocation must be fully defined (lat, lon, and label) or not defined at all.'));
    } else {
        next();
    }
});

const User = mongoose.model('User', userSchema);

export default User;