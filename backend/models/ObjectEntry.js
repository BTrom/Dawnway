const mongoose = require('mongoose');

const ObjectSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    category: {
        type: String,
        enum: ['entity', 'furniture', 'consumable', 'tool', 'material', 'miscellaneous'],
        required: true
    }
});

module.exports = mongoose.model('ObjectEntry', ObjectSchema);