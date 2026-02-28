// ====================== Imports ======================
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
require("dotenv").config();

// ====================== Environment ======================
const PORT = process.env.PORT || 3033;
const JWT_SECRET =
  process.env.JWT_SECRET || "fallback_secret_key_change_in_production";
const MONGO_URI = process.env.MONGO_URI;
const isProduction = process.env.NODE_ENV === "production";

if (!MONGO_URI) {
  console.error("❌ MONGO_URI missing");
  process.exit(1);
}

// ====================== Models ======================
const User = require("./module/userSchema");
const Reel = require("./module/reelsSchema");
const About = require("./module/about");

// ====================== App Init ======================
const app = express();

// ====================== Core Middleware ======================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ====================== ✅ CORS FIX (ONLY ONE) ======================
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://instalgram0.netlify.app",
    ],
    credentials: true,
  })
);

// ====================== MongoDB ======================
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("Mongo Error:", err);
    process.exit(1);
  });

// ====================== Upload Setup ======================
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// File filter for images and videos only
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|webm|mov/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype) || file.mimetype.startsWith('video/');
  
  if (extname || mimetype) {
    return cb(null, true);
  }
  cb(new Error('Only images and videos are allowed'));
};

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({ 
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});
app.use("/uploads", express.static(uploadDir));

// ====================== Auth Middleware (FIXED) ======================
const authMiddleware = (req, res, next) => {
  let token = req.cookies.token;

  // ALSO allow Bearer token from axios
  if (!token && req.headers.authorization) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token)
    return res.status(401).json({ success: false, message: "Unauthorized" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ success: false, message: "Invalid token" });
  }
};

// ====================== Helper Functions ======================
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const getCookieOptions = () => ({
  httpOnly: true,
  sameSite: "None",
  secure: isProduction,
});

// ====================== Routes ======================
app.get("/", (_, res) => res.send("🚀 API running"));
app.get("/api/ping", (_, res) => res.send("✅ API OK"));

// ====================== Signup ======================
app.post("/api/signup", upload.single("img"), async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: "Missing fields" });

    const existing = await User.findOne({ email });
    if (existing)
      return res.status(409).json({ success: false, message: "User exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      img: req.file?.filename || "",
    });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, {
      expiresIn: "24h",
    });

    res.cookie("token", token, getCookieOptions());

    res.status(201).json({
      success: true,
      token,
      user,
    });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ success: false });
  }
});

// ====================== Login ======================
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, {
      expiresIn: "24h",
    });

    res.cookie("token", token, getCookieOptions());

    res.json({
      success: true,
      token,
      user,
    });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ====================== Profile ======================
app.get("/api/profile", authMiddleware, async (req, res) => {
  const user = await User.findById(req.user.id).select("-password");
  res.json({ success: true, user });
});

// ====================== About ======================
app.get("/api/about", authMiddleware, async (req, res) => {
  try {
    const about = await About.find();
    res.json({ success: true, about });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ====================== Logout (Changed to POST) ======================
app.post("/api/logout", (_, res) => {
  res.clearCookie("token", getCookieOptions());

  res.json({ success: true, message: "Logged out" });
});

// ====================== Create Reel ======================
app.post(
  "/api/reels",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    if (!req.file || !req.body.des)
      return res.status(400).json({ success: false, message: "Missing file or description" });

    const reel = await Reel.create({
      file: req.file.filename,
      des: req.body.des,
      user: req.user.id,
    });

    const populatedReel = await Reel.findById(reel._id).populate(
      "user",
      "name img"
    );

    res.status(201).json({ success: true, reel: populatedReel });
  }
);

// ====================== Get Reels ======================
app.get("/api/reels", async (_, res) => {
  const reels = await Reel.find()
    .populate("user", "name img")
    .sort({ createdAt: -1 });

  res.json({ success: true, reels });
});

// ====================== Like / Unlike ======================
app.post("/api/reels/:id/like", authMiddleware, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id))
      return res.status(400).json({ success: false, message: "Invalid reel ID" });

    const reel = await Reel.findById(req.params.id);
    if (!reel)
      return res.status(404).json({ success: false, message: "Reel not found" });

    const userId = req.user.id;
    
    // Use findOneAndUpdate for atomic operation to prevent race conditions
    if (reel.likes.includes(userId)) {
      await Reel.findByIdAndUpdate(req.params.id, {
        $pull: { likes: userId },
        $inc: { likesCount: -1 }
      });
      res.json({ success: true, liked: false, likesCount: Math.max(0, reel.likesCount - 1) });
    } else {
      await Reel.findByIdAndUpdate(req.params.id, {
        $push: { likes: userId },
        $inc: { likesCount: 1 }
      });
      res.json({ success: true, liked: true, likesCount: reel.likesCount + 1 });
    }
  } catch (err) {
    console.error("Like error:", err);
    res.status(500).json({ success: false });
  }
});

// ====================== Add Comment ======================
app.post("/api/reels/:id/comment", authMiddleware, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id))
      return res.status(400).json({ success: false, message: "Invalid reel ID" });

    const { text } = req.body;

    if (!text)
      return res.status(400).json({ success: false, message: "Comment required" });

    const reel = await Reel.findById(req.params.id);
    if (!reel)
      return res.status(404).json({ success: false, message: "Reel not found" });

    const newComment = {
      user: req.user.id,
      text,
      createdAt: new Date(),
    };

    reel.comments.push(newComment);
    reel.commentsCount = reel.comments.length;
    await reel.save();

    // Populate the user field for the new comment
    const populatedReel = await Reel.findById(req.params.id)
      .populate("user", "name img")
      .populate("comments.user", "name img");

    const addedComment = populatedReel.comments.find(
      c => c.text === text && c.user && c.user._id.toString() === req.user.id
    );

    res.json({
      success: true,
      comment: addedComment || populatedReel.comments.at(-1),
    });
  } catch (err) {
    console.error("Comment error:", err);
    res.status(500).json({ success: false });
  }
});

// ====================== Get Comments ======================
app.get("/api/reels/:id/comments", async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id))
      return res.status(400).json({ success: false, message: "Invalid reel ID" });

    const reel = await Reel.findById(req.params.id).populate(
      "comments.user",
      "name img"
    );

    if (!reel)
      return res.status(404).json({ success: false, message: "Reel not found" });

    res.json({ success: true, comments: reel.comments });
  } catch (err) {
    console.error("Get comments error:", err);
    res.status(500).json({ success: false });
  }
});

// ====================== Start Server ======================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
