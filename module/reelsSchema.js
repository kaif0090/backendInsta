// videoModel.js
const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const videoSchema = new mongoose.Schema({
  des: { type: String, required: true },
  file: { type: String, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  likesCount: { type: Number, default: 0 },
  commentsCount: { type: Number, default: 0 },
  comments: [commentSchema],
  sharesCount: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model("Reel", videoSchema);
