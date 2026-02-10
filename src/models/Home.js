import mongoose from 'mongoose';

const homeSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        required: true
    },
    image: {
        src: { type: String, required: true },
        alt: { type: String, required: true }
    },
    button: [{
        text: { type: String },
        href: { type: String },
        target: { type: String }
    }],
    order: {
        mediumView: {
            row: Number,
            column: Number
        },
        largeView: {
            row: Number,
            column: Number
        },
        position: {
            type: Number
        }
    }
},
{collection: 'home'});

const Home = mongoose.model('Home', homeSchema);

export default Home;