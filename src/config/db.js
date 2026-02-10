import mongoose from 'mongoose';

const connectDB = async () => {
    try {
        const mongoURI = process.env.MONGODB_URI;
        if (!mongoURI) {
            throw new Error('MONGODB_URI is not defined in environment variables.');
        }

        await mongoose.connect(mongoURI, {
        });
        console.log('MongoDB Atlas Connected...');
    } catch (err) {
        console.error('MongoDB Atlas Connection Error:', err.message);
        process.exit(1);
    }
};

export default connectDB;