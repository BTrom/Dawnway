const mongoose = require('mongoose');

const eventLogSchema = new mongoose.Schema({
    agent: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Agent',
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    event_category: {
        type: String,
        enum: ['milestone', 'action', 'death', 'learning'],
        required: true
    },
    description: {
        type: String,
        required: true
    },
    action: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Action',
        required: true
    },
});

module.exports = mongoose.model('EventLog', eventLogSchema);