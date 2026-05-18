const mongoose = require('mongoose');

const agentSchema = new mongoose.Schema({
    // Link to the User.js model who created this character
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    surname: {
        type: String,
        required: true,
        trim: true
    },
    gender: {
        type: String,
        enum: ['male', 'female', 'other'],
        required: true
    },
    age: {
        type: Number,
        required: true,
        min: 0
    },
    creation_date: {
        type: Date,
        default: Date.now
    }
    // PEN Personality Model (Reserved for later, scaled 0-100 for simplicity)
    // personality: {
    //     psychoticism: { type: Number, default: 50 },
    //     extraversion: { type: Number, default: 50 },
    //     neuroticism: { type: Number, default: 50 }
    // }
});

module.exports = mongoose.model('Agent', agentSchema);