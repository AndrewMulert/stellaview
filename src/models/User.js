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
        },
        cachedNearbySites: {
            sites: [{
                name: String,
                lat: Number,
                lon: Number,
                bortle: Number,
                vegetation: Number,
                distance: Number,
                osmId: String,
                score: Number,
                bestTime: Date,
                avgTemp: Number,
                avgClouds: Number
            }],
            lastUpdated: {
                type: Date,
                default: Date.now
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
        homeBase: {
            lat: Number,
            lon: Number,
            label: String
        },
        discoveredSites: [{
            name: String,
            lat: Number,
            lon: Number,
            radiance: Number,
            ndvi: Number,
            bortle: Number,
            mapUrl: String
        }],
        timestamp: { 
            type: Date, 
            default: Date.now 
        }
    }]
},
{collection: 'user'});

userSchema.pre('validate', function(next) {
    const loc = this.preferences.homeLocation;
    const hasAny = !!(loc.lat || loc.lon || loc.label);
    const hasAll = !!(loc.lat && loc.lon && loc.label);
    
    if(hasAny && !hasAll) {
        next(new Error('homeLocation must be fully defined (lat, lon, and label) or not defined at all.'));
    } else {
        next();
    }
});

const User = mongoose.model('User', userSchema);

export default User;