import dotenv from "dotenv";
dotenv.config();

import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import cors from "cors";
import fs from "fs";
import path from "path";
import db from "./database.js";

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(cors());

app.use("/videos", express.static("videos"));
app.use("/thumbnails", express.static("thumbnails"));

/* Ensure folders exist */

["videos", "thumbnails", "temp"].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
});

/* Upload handler */

const upload = multer({
  dest: "temp/",
  limits: { fileSize: 20 * 1024 * 1024 },
});

app.post("/upload", upload.single("video"), async (req, res) => {
  const inputPath = req.file.path;

  const videoName = Date.now() + ".mp4";
  const outputVideo = path.join("videos", videoName);
  const thumbnailName = videoName + ".jpg";
  const thumbnailPath = path.join("thumbnails", thumbnailName);

  try {
    /* Compress video */

    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions(["-vcodec libx264", "-crf 28"])
        .save(outputVideo)
        .on("end", resolve)
        .on("error", reject);
    });

    /* Generate thumbnail */

    await new Promise((resolve, reject) => {
      ffmpeg(outputVideo)
        .screenshots({
          timestamps: ["1"],
          filename: thumbnailName,
          folder: "thumbnails",
        })
        .on("end", resolve)
        .on("error", reject);
    });

    /* Delete temp file */

    fs.unlinkSync(inputPath);

    /* Save record in database */

    db.run(
      `
      INSERT INTO evidence (snag_id, filename, thumbnail, uploaded_by)
      VALUES (?, ?, ?, ?)
      `,
      [1, videoName, thumbnailName, 1],
    );

    /* Send response */

    res.json({
      video: "/videos/" + videoName,
      thumbnail: "/thumbnails/" + thumbnailName,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("processing failed");
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
