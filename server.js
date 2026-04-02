import express from "express";
import multer from "multer";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import cors from "cors";
import fs from "fs";
import path from "path";

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(cors());

app.use("/videos", express.static("videos"));
app.use("/thumbnails", express.static("thumbnails"));

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 20 * 1024 * 1024 },
});

app.post("/upload", upload.single("video"), async (req, res) => {
  const inputPath = req.file.path;
  const videoName = Date.now() + ".mp4";

  const outputVideo = path.join("videos", videoName);
  const thumbnail = path.join("thumbnails", videoName + ".jpg");

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions(["-vcodec libx264", "-crf 28"])
        .save(outputVideo)
        .on("end", resolve)
        .on("error", reject);
    });

    await new Promise((resolve, reject) => {
      ffmpeg(outputVideo)
        .screenshots({
          timestamps: ["1"],
          filename: videoName + ".jpg",
          folder: "thumbnails",
        })
        .on("end", resolve)
        .on("error", reject);
    });

    fs.unlinkSync(inputPath);

    res.json({
      video: "/videos/" + videoName,
      thumbnail: "/thumbnails/" + videoName + ".jpg",
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("processing failed");
  }
});

app.listen(3000, () => {
  console.log("server running on port 3000");
});
