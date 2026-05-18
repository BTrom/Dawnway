const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    password: {
        type: String,
        required: true
    },
    register_date: {
        type: Date,
        default: Date.now
    },
    character_limit: {
        type: Number,
        default: 3
    }
});

// Create and export the model
module.exports = mongoose.model('User', userSchema);