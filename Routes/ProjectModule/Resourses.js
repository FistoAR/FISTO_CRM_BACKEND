const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs/promises");
const mongoose = require("mongoose");
const { queryWithRetry } = require("../../dataBase/connection");
const { Resources } = require("../../Models/DB_Collections");

const router = express.Router();

const MAX_PROJECT_SIZE_BYTES = 50 * 1024 * 1024; 

const assetStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "Images/Resources/";
    fs.mkdir(dir, { recursive: true })
      .then(() => cb(null, dir))
      .catch(cb);
  },
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname)),
});

const upload = multer({
  storage: assetStorage,
  fileFilter: (req, file, cb) => {
    const allowedMime = [
      "image/jpeg",
      "image/png",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/zip",
      "application/x-zip-compressed",
    ];
    const allowedExt = [
      ".jpg",
      ".jpeg",
      ".webp",
      ".pdf",
      ".doc",
      ".docx",
      ".zip",
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedMime.includes(file.mimetype) && allowedExt.includes(ext))
      return cb(null, true);
    cb(new Error("File type not supported."));
  },
});


const meetStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "Images/MeetDocuments/";
    fs.mkdir(dir, { recursive: true })
      .then(() => cb(null, dir))
      .catch(cb);
  },
  filename: (req, file, cb) =>
    cb(null, Date.now() + "_meet" + path.extname(file.originalname)),
});

const uploadMeetDocs = multer({
  storage: meetStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMime = [
      "image/jpeg",
      "image/png",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/zip",
      "application/x-zip-compressed",
    ];
    const allowedExt = [
      ".jpg",
      ".jpeg",
      ".png",
      ".pdf",
      ".doc",
      ".docx",
      ".zip",
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedMime.includes(file.mimetype) && allowedExt.includes(ext))
      return cb(null, true);
    cb(new Error("File type not supported for meet documents."));
  },
});

router.get("/active", async (req, res) => {
  try {
    const details = `
      SELECT employee_id   AS id,
             employee_name AS name,
             profile_url   AS profile,
             designation   AS department
      FROM employees_details
      WHERE working_status = 'Active'
    `;

    const employees = await queryWithRetry(details);

    return res.json({ data: employees });
  } catch (error) {
    console.error("Fetch active employees error:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
});

router.post(
  "/:projectId/files",
  upload.array("files", 10),
  async (req, res) => {
    try {
      if (!req.files?.length)
        return res.status(400).json({ message: "No files uploaded." });

      const { projectId } = req.params;
      let resource = await Resources.findOne({ projectId });
      let isNew = false;
      if (!resource) {
        isNew = true;
        resource = new Resources({
          projectId,
          employeeID: req.body.employeeID || null,
        });
      }

      const totalNewSize = req.files.reduce((s, f) => s + f.size, 0);
      if (resource.size + totalNewSize > MAX_PROJECT_SIZE_BYTES) {
        await Promise.all(req.files.map((f) => fs.unlink(f.path)));
        return res
          .status(413)
          .json({ message: "Adding these files would exceed the 50MB limit." });
      }

      resource.files.push(
        ...req.files.map((f) => ({
          filename: f.originalname,
          filepath: f.path.replace(/\\/g, "/"),
          size: f.size,
        })),
      );
      resource.size += totalNewSize;
      const saved = await resource.save();

      res.status(201).json({
        message: isNew
          ? `Resource created and ${req.files.length} file(s) added.`
          : `${req.files.length} file(s) added.`,
        data: saved,
      });
    } catch (error) {
      console.error("File upload error:", error);
      if (req.files)
        await Promise.all(
          req.files.map((f) => fs.unlink(f.path).catch(() => {})),
        );
      res
        .status(500)
        .json({
          message: "Unexpected error during file upload.",
          error: error.message,
        });
    }
  },
);

router.post("/:projectId/links", async (req, res) => {
  try {
    const { projectId } = req.params;
    const { links, employeeID } = req.body;
    if (!Array.isArray(links) || !links.length)
      return res.status(400).json({ message: "links array is required." });

    const updated = await Resources.findOneAndUpdate(
      { projectId },
      {
        $push: { links: { $each: links } },
        $setOnInsert: { employeeID: employeeID || "" },
      },
      { new: true, upsert: true, runValidators: true },
    );
    res
      .status(201)
      .json({ message: `${links.length} link(s) added.`, data: updated });
  } catch (error) {
    console.error("Add links error:", error);
    if (error instanceof mongoose.Error.ValidationError)
      return res
        .status(400)
        .json({ message: "Validation failed.", error: error.message });
    res.status(500).json({ message: "Server error.", error: error.message });
  }
});


router.post(
  "/:projectId/meets",
  uploadMeetDocs.array("meetDocuments", 5),
  async (req, res) => {
    const cleanup = () =>
      req.files
        ? Promise.all(req.files.map((f) => fs.unlink(f.path).catch(() => {})))
        : Promise.resolve();

    try {
      const { projectId } = req.params;
      const {
        title,
        mode,
        location,
        date,
        startTime,
        endTime,
        description,
        employeeID,
      } = req.body;

      // ── Validation ──────────────────────────
      if (!mode?.trim()) {
        await cleanup();
        return res.status(400).json({ message: "Meeting mode is required." });
      }
      const validModes = ["Online", "Client Base", "Our Company"];
      if (!validModes.includes(mode)) {
        await cleanup();
        return res
          .status(400)
          .json({
            message: `Invalid mode. Must be one of: ${validModes.join(", ")}.`,
          });
      }
      if (mode === "Client Base" && !location?.trim()) {
        await cleanup();
        return res
          .status(400)
          .json({ message: "Location is required for Client Base meetings." });
      }
      if (!date) {
        await cleanup();
        return res.status(400).json({ message: "Meeting date is required." });
      }
      if (!startTime) {
        await cleanup();
        return res.status(400).json({ message: "Start time is required." });
      }
      if (!endTime) {
        await cleanup();
        return res.status(400).json({ message: "End time is required." });
      }
      if (startTime >= endTime) {
        await cleanup();
        return res
          .status(400)
          .json({ message: "End time must be after start time." });
      }

      // ── Parse JSON attendees ─────────────────
      let clientAttendees = [],
        ourAttendees = [];
      try {
        clientAttendees = JSON.parse(req.body.clientAttendees || "[]");
      } catch {
        clientAttendees = [];
      }
      try {
        ourAttendees = JSON.parse(req.body.ourAttendees || "[]");
      } catch {
        ourAttendees = [];
      }

      if (!clientAttendees.length) {
        await cleanup();
        return res
          .status(400)
          .json({ message: "At least one client-side attendee is required." });
      }
      if (!ourAttendees.length) {
        await cleanup();
        return res
          .status(400)
          .json({ message: "At least one our-side attendee is required." });
      }

      const meetEntry = {
        title: (title || "").trim(), 
        mode: mode.trim(),
        location: mode === "Client Base" ? (location || "").trim() : "",
        date: new Date(date),
        startTime,
        endTime,
        clientAttendees: clientAttendees
          .map((a) => String(a).trim())
          .filter(Boolean),
        ourAttendees: ourAttendees.map((e) => ({
          id: String(e.id),
          name: String(e.name),
          department: e.department || "",
        })),
        description: (description || "").trim(),
        createdBy: employeeID || "",
        documents: (req.files || []).map((f) => ({
          filename: f.originalname,
          filepath: f.path.replace(/\\/g, "/"),
          size: f.size,
          mimetype: f.mimetype,
        })),
      };

      const updated = await Resources.findOneAndUpdate(
        { projectId },
        {
          $push: { meets: meetEntry },
          $setOnInsert: { employeeID: employeeID || "" },
        },
        { new: true, upsert: true, runValidators: true },
      );

      res
        .status(201)
        .json({ message: "Client meet added successfully.", data: updated });
    } catch (error) {
      console.error("Add meet error:", error);
      await cleanup();
      if (error instanceof mongoose.Error.ValidationError)
        return res
          .status(400)
          .json({ message: "Validation failed.", error: error.message });
      res.status(500).json({ message: "Server error.", error: error.message });
    }
  },
);


router.get("/:projectId", async (req, res) => {
  try {
    const resource = await Resources.findOne({
      projectId: req.params.projectId,
    });
    if (!resource)
      return res
        .status(200)
        .json({ message: "No resources found for this project." });
    res.status(200).json({ data: resource });
  } catch (error) {
    res.status(500).json({ message: "Server Error", error: error.message });
  }
});


router.delete("/:projectId/files/:fileId", async (req, res) => {
  try {
    const { projectId, fileId } = req.params;
    const resource = await Resources.findOne({ projectId });
    if (!resource)
      return res.status(404).json({ message: "Project resource not found." });

    const file = resource.files.id(fileId);
    if (!file) return res.status(404).json({ message: "File not found." });

    await fs.unlink(file.filepath).catch(() => {}); 
    resource.size = Math.max(0, resource.size - file.size);
    resource.files.pull(fileId);
    await resource.save();

    res.status(200).json({ message: "File deleted successfully." });
  } catch (error) {
    console.error("Delete file error:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
});


router.delete("/:projectId/links/:linkId", async (req, res) => {
  try {
    const { projectId, linkId } = req.params;
    const result = await Resources.updateOne(
      { projectId },
      { $pull: { links: { _id: linkId } } },
    );
    if (result.modifiedCount === 0 && result.nModified === 0)
      return res.status(404).json({ message: "Link not found." });
    res.status(200).json({ message: "Link deleted successfully." });
  } catch (error) {
    console.error("Delete link error:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
});


router.delete("/:projectId/meets/:meetId", async (req, res) => {
  try {
    const { projectId, meetId } = req.params;
    const resource = await Resources.findOne({ projectId });
    if (!resource)
      return res.status(404).json({ message: "Project resource not found." });

    const meet = resource.meets.id(meetId);
    if (!meet) return res.status(404).json({ message: "Meet not found." });

    if (meet.documents?.length) {
      await Promise.all(
        meet.documents.map((d) =>
          fs
            .unlink(d.filepath)
            .catch((e) => console.error(`Cleanup: ${d.filepath}`, e)),
        ),
      );
    }

    resource.meets.pull(meetId);
    await resource.save();

    res.status(200).json({ message: "Client meet deleted successfully." });
  } catch (error) {
    console.error("Delete meet error:", error);
    res.status(500).json({ message: "Server Error", error: error.message });
  }
});

module.exports = router;
