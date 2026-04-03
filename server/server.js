import dotenv from "dotenv";
dotenv.config();

import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import cors from "cors";
import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
import db from "./database.js";

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(cors());

app.use("/videos", express.static("evidence/watermarked"));
app.use("/thumbnails", express.static("thumbnails"));

/* Ensure folders exist */
["evidence/original", "evidence/watermarked", "thumbnails", "temp"].forEach(
  (dir) => {
    fs.ensureDirSync(dir);
  },
);

/* Multer config for temp uploads */
const upload = multer({
  dest: "temp/",
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

const FONT_PATH = path.join(
  "fonts",
  "Roboto",
  "Roboto-VariableFont_wdth,wght.ttf",
);

app.post("/upload", upload.single("video"), async (req, res) => {
  const inputPath = req.file.path;

  const timestamp = Date.now();
  const originalName = `orig_${timestamp}.mp4`;
  const watermarkedName = `vid_${timestamp}.mp4`;
  const thumbnailName = `thumb_${timestamp}.jpg`;

  const originalPath = path.join("evidence/original", originalName);
  const watermarkedPath = path.join("evidence/watermarked", watermarkedName);
  const thumbnailPath = path.join("thumbnails", thumbnailName);

  try {
    // Move original to evidence/original
    await fs.move(inputPath, originalPath, { overwrite: true });

    // Compute SHA256 hash
    const fileBuffer = await fs.readFile(originalPath);
    const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

    // Check duplicate
    const duplicate = await new Promise((resolve, reject) => {
      db.get("SELECT * FROM evidence WHERE hash = ?", [hash], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (duplicate) {
      await fs.remove(originalPath);
      return res.status(400).json({ error: "Duplicate video detected" });
    }

    // Prepare escaped timestamp for ffmpeg
    const now = new Date();
    const timestampText = now
      .toLocaleString()
      .replace(/:/g, "\\:")
      .replace(/,/g, "\\,");

    // Compress and watermark
    await new Promise((resolve, reject) => {
      ffmpeg(originalPath)
        .outputOptions(["-vcodec libx264", "-crf 28"])
        .videoFilters({
          filter: "drawtext",
          options: {
            fontfile: FONT_PATH,
            text: `Snag: 1  User: John  ${timestampText}`,
            fontsize: 24,
            fontcolor: "white",
            x: 10,
            y: 30,
            shadowcolor: "black",
            shadowx: 2,
            shadowy: 2,
          },
        })
        .save(watermarkedPath)
        .on("end", resolve)
        .on("error", (err, stdout, stderr) => {
          console.error("FFMPEG ERROR:", err);
          console.error(stderr);
          reject(err);
        });
    });

    // Generate thumbnail
    await new Promise((resolve, reject) => {
      ffmpeg(watermarkedPath)
        .screenshots({
          timestamps: ["1"],
          filename: thumbnailName,
          folder: "thumbnails",
        })
        .on("end", resolve)
        .on("error", (err, stdout, stderr) => {
          console.error("THUMBNAIL ERROR:", err);
          console.error(stderr);
          reject(err);
        });
    });

    // Save to SQLite
    db.run(
      "INSERT INTO evidence (snag_id, filename, thumbnail, hash, uploaded_by) VALUES (?, ?, ?, ?, ?)",
      [1, watermarkedName, thumbnailName, hash, 1],
    );

    res.json({
      video: "/videos/" + watermarkedName,
      thumbnail: "/thumbnails/" + thumbnailName,
    });
  } catch (err) {
    console.error("UPLOAD PROCESSING FAILED:", err);
    res.status(500).send("Processing failed");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
