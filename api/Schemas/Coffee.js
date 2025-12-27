const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * Coffee schema
 */
const CoffeeSchema = new Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  imageUrl: { type: String, required: true },
});

module.exports =
  mongoose.model("Coffee", CoffeeSchema) || mongoose.model("Coffee");
