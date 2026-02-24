const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  img: String, // Image URL (from file or link)
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
