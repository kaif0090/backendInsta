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

// ====================== Environment Variables Validation ======================
const PORT = process.env.PORT || 3033;
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_key_change_in_production";
const MONGO_URI = process.env.MONGO_URI;
const CORS_ORIGIN = process.env.CORS_ORIGIN ||"https://instalgram0.netlify.app";

// Validate required environment variables
if (!MONGO_URI) {
  console.error("❌ ERROR: MONGO_URI is not defined in .env file!");
  console.error("Please add MONGO_URI to your .env file (e.g., MONGO_URI=mongodb://localhost:27017/instagram)");
  process.exit(1);
}

if (!process.env.JWT_SECRET) {
  console.warn("⚠️ WARNING: JWT_SECRET is not defined in .env file! Using default (not secure for production)");
}

// ====================== Models ======================
const User = require("./module/userSchema");
const Reel = require("./module/reelsSchema");
const About = require("./module/about")

// ====================== App Init ======================
const app = express();

// ====================== Core Middleware ======================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ====================== CORS Configuration ======================
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://instalgram0.netlify.app",
    ],
    credentials: true,
  })
);

app.options("*", cors());
app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin (mobile apps/postman)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
  next()
);


// ====================== MongoDB ======================
// Detect if using MongoDB Atlas (contains +srv) or local
const isAtlas = MONGO_URI && MONGO_URI.includes("+srv");

mongoose
  .connect(MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    tls: isAtlas, // Only use TLS for Atlas connections
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB connection failed:", err.message);
    console.error("Please check your MONGO_URI in .env file");
    process.exit(1);
  });

// ====================== Upload Setup ======================
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({ storage });
app.use("/uploads", express.static(uploadDir));

// ====================== Auth Middleware ======================
const authMiddleware = (req, res, next) => {
  const token = req.cookies.token;
  if (!token)
    return res.status(401).json({ success: false, message: "Unauthorized" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ success: false, message: "Invalid token" });
  }
};

// ====================== Routes ======================
app.get("/", (_, res) => res.send("🚀 API running"));
app.get("/api/ping", (_, res) => res.send("✅ API OK"));

// ====================== Signup ======================
app.post("/api/signup", upload.single("img"), async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Missing fields" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res
        .status(409)
        .json({ success: false, message: "User already exists" });
    }

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

    res
      .cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "None",
        secure: true,
      })
      .status(201)
      .json({
        success: true,
        token, // ⭐ ADD
        message: "Signup successful",
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
        },

      });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ success: false, message: "Signup failed" });
  }
});

// ====================== Login ======================
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const token = jwt.sign({ id: user._id }, JWT_SECRET, {
      expiresIn: "24h",
    });

    res
      .cookie("token", token, {
        httpOnly: true,
        sameSite: "None",
        secure: true,
      })
      .json({
        success: true,
        token: token, // ⭐ MUST EXIST
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
        },
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


app.get("/api/about", authMiddleware, async (req, res) => {
  try {
    const about = await About.find(); // ✅ get all docs
    res.json({ success: true, about });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ====================== Logout ======================
app.get("/api/logout", (_, res) => {
  res
    .clearCookie("token", {
      sameSite: "None",
      secure: true,
      secure: process.env.NODE_ENV === "production"
    })
    .json({ success: true, message: "Logged out" });
});

// ====================== Reels ======================
app.post("/api/reels", authMiddleware, upload.single("file"), async (req, res) => {
  if (!req.file || !req.body.des) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid input" });
  }

  const reel = await Reel.create({
    file: req.file.filename,
    des: req.body.des,
    user: req.user.id,
  });

  const populatedReel = await Reel.findById(reel._id).populate('user', 'name img');

  res.status(201).json({ success: true, reel: populatedReel });
});

app.get("/api/reels", async (_, res) => {
  const reels = await Reel.find()
    .populate('user', 'name img')
    .sort({ createdAt: -1 });
  res.json({ success: true, reels });
});

// ====================== Like/Unlike Reel ======================
app.post("/api/reels/:id/like", authMiddleware, async (req, res) => {
  try {
    const reel = await Reel.findById(req.params.id);
    if (!reel) {
      return res.status(404).json({ success: false, message: "Reel not found" });
    }

    // Initialize likes array if it doesn't exist
    if (!reel.likes) {
      reel.likes = [];
    }
    if (typeof reel.likesCount !== 'number') {
      reel.likesCount = 0;
    }

    const userId = req.user.id;
    const likeIndex = reel.likes.indexOf(userId);

    if (likeIndex > -1) {
      // Already liked, unlike it
      reel.likes.splice(likeIndex, 1);
      reel.likesCount = Math.max(0, reel.likesCount - 1);
    } else {
      // Not liked, like it
      reel.likes.push(userId);
      reel.likesCount += 1;
    }

    await reel.save();

    res.json({
      success: true,
      liked: likeIndex === -1,
      likesCount: reel.likesCount
    });
  } catch (err) {
    console.error("Like error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ====================== Add Comment ======================
app.post("/api/reels/:id/comment", authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ success: false, message: "Comment text required" });
    }

    const reel = await Reel.findById(req.params.id);
    if (!reel) {
      return res.status(404).json({ success: false, message: "Reel not found" });
    }

    const comment = {
      user: req.user.id,
      text: text,
      createdAt: new Date()
    };

    reel.comments.push(comment);
    reel.commentsCount = reel.comments.length;
    await reel.save();

    // Populate the new comment with user info
    const populatedReel = await Reel.findById(req.params.id)
      .populate('user', 'name img')
      .populate('comments.user', 'name img');

    res.json({ success: true, comment: populatedReel.comments[populatedReel.comments.length - 1] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ====================== Get Comments ======================
app.get("/api/reels/:id/comments", async (req, res) => {
  try {
    const reel = await Reel.findById(req.params.id)
      .populate('comments.user', 'name img')
      .sort({ 'comments.createdAt': -1 });

    if (!reel) {
      return res.status(404).json({ success: false, message: "Reel not found" });
    }

    res.json({ success: true, comments: reel.comments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ====================== Start Server ======================
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
