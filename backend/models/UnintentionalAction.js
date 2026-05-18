const mongoose = require('mongoose');

const UnintActionSchema = new mongoose.Schema({
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
        enum: ['accident', 'reflex'],
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
    needs_trigger: {
        hunger:  { type: Number },
        thirst:  { type: Number },
        bladder: { type: Number },
        sleep:   { type: Number },
        hygiene: { type: Number },
        health:  { type: Number }
    },
});

module.exports = mongoose.model('UnintentionalAction', UnintActionSchema);