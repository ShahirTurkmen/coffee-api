const mongoose = require('mongoose');

const CoffeeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  image: { type: String },
  description: { type: String },
  legacyId: { type: Number },
}, { timestamps: true });

module.exports = mongoose.models.Coffee || mongoose.model('Coffee', CoffeeSchema);
