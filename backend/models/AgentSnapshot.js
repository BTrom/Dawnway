const mongoose = require('mongoose');

const agentSnapshotSchema = new mongoose.Schema({
    agent: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Agent',
        required: true
    },
    // last_saved: {
    //     type: Date,
    //     default: Date.now
    // },
    timestamp: {
        type: Date,
        required: true,
        default: Date.now
    },
    needs: {
        hunger:  { type: Number, default: 100 },
        thirst:  { type: Number, default: 100 },
        bladder: { type: Number, default: 100 },
        sleep:   { type: Number, default: 100 },
        hygiene: { type: Number, default: 100 },
        health:  { type: Number, default: 100 }
    },
    emotions: {
        joy:     { type: Number, default: 50 },
        sadness: { type: Number, default: 0 },
        anger:   { type: Number, default: 0 },
        fear:    { type: Number, default: 0 }
    },
    // The actual "Brain" (Linear Function Approximation weights)
    // Stored as a flexible Map of strings to numbers (e.g., "Feature_Water_Hydration": 8.5)
    lfa_weights: {
        type: Map,
        of: Number,
        // Using a function ensures a fresh Map is created for every new document
        default: () => new Map()
    }
}, {
    // This tells MongoDB to treat this as a highly optimized Time Series collection
    timeseries: {
        timeField: 'timestamp',
        metaField: 'agent',
        granularity: 'minutes' // Tells Mongo to expect updates roughly every minute
    }
});

module.exports = mongoose.model('AgentSnapshot', agentSnapshotSchema);