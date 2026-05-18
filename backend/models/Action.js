const mongoose = require('mongoose');

const ActionSchema = new mongoose.Schema({
    object: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Objecttest',
        required: true
    },
    name: {
        type: String,
        required: true
    },
    category: {
        type: String,
        enum: ['core', 'leisure', 'reflexive', 'social'],
        required: true
    },
    // intentional: {
    //     type: Boolean,
    //     default: true
    // },
    duration: {
        type: Number,
        required: true,
        default: 1
    },
    needs_effect: {
        hunger:  { type: Number, default: 0 },
        thirst:  { type: Number, default: 0 },
        bladder: { type: Number, default: 0 },
        sleep:   { type: Number, default: 0 },
        hygiene: { type: Number, default: 0 },
        health:  { type: Number, default: 0 }
    },
});

module.exports = mongoose.model('Action', ActionSchema);