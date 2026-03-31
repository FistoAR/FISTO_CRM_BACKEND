const express = require("express");
const multer = require("multer");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const router = express.Router();

const upload = multer({
  dest: "temp/",
  limits: { fileSize: 100 * 1024 * 1024 },
});

// ─── OAuth2 Setup ───
const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

const TOKEN_PATH = path.join(__dirname, "../../tokens.json");

// ─── TOKEN HELPERS ───
// Supports BOTH local file (development) AND env vars (Render/production)

function loadTokens() {
  // 1. Try environment variable first (production/Render)
  if (process.env.GOOGLE_TOKENS) {
    try {
      const tokens = JSON.parse(process.env.GOOGLE_TOKENS);
      oauth2Client.setCredentials(tokens);
      console.log("✅ Drive: tokens loaded from GOOGLE_TOKENS env var");
      return;
    } catch (e) {
      console.error("❌ Drive: Failed to parse GOOGLE_TOKENS env var:", e.message);
    }
  }

  // 2. Fallback to local file (development)
  if (fs.existsSync(TOKEN_PATH)) {
    try {
      const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
      oauth2Client.setCredentials(tokens);
      console.log("✅ Drive: tokens loaded from tokens.json file");
      return;
    } catch (e) {
      console.error("❌ Drive: Failed to read tokens.json:", e.message);
    }
  }

  console.warn("⚠️  Drive: No tokens found. Visit /api/drive/auth to authenticate.");
}

function saveTokens(tokens) {
  // Always try to save to file (works locally, silently fails on Render read-only FS)
  try {
    let existing = {};
    if (fs.existsSync(TOKEN_PATH)) {
      existing = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
    }
    const updated = { ...existing, ...tokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(updated));
    console.log("✅ Drive: tokens saved to file");
  } catch (e) {
    // On Render, filesystem may be read-only — that's fine, tokens are in env
    console.log("ℹ️  Drive: Could not save tokens to file (normal on Render)");
  }
}

// Load tokens on startup
loadTokens();

// ─── Auto-save refreshed tokens ───
oauth2Client.on("tokens", (newTokens) => {
  saveTokens(newTokens);
  console.log("✅ Drive: tokens auto-refreshed");
});

const drive = google.drive({ version: "v3", auth: oauth2Client });

// ─── MIME icon helper ───
const getMimeIcon = (mimeType) => {
  if (mimeType === "application/vnd.google-apps.folder") return "folder";
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("video/")) return "video";
  if (mimeType?.startsWith("audio/")) return "audio";
  if (mimeType?.includes("pdf")) return "pdf";
  if (mimeType?.includes("spreadsheet") || mimeType?.includes("excel")) return "spreadsheet";
  if (mimeType?.includes("document") || mimeType?.includes("word")) return "document";
  if (mimeType?.includes("presentation") || mimeType?.includes("powerpoint")) return "presentation";
  if (mimeType?.includes("zip") || mimeType?.includes("archive")) return "archive";
  return "file";
};

// ════════════════════════════════
// AUTH ROUTES (run once to get tokens)
// ════════════════════════════════

router.get("/auth", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/drive"],
    prompt: "consent",
  });
  res.redirect(url);
});

router.get("/auth/callback", async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    saveTokens(tokens);
    console.log("✅ New tokens obtained!");

    // Show the token value so you can copy it into Render env var
    res.send(`
      <h2>✅ Google Drive Connected!</h2>
      <p>Tokens obtained successfully.</p>
      <hr/>
      <h3>⚠️ For Render deployment:</h3>
      <p>Add this as environment variable <strong>GOOGLE_TOKENS</strong> in your Render dashboard:</p>
      <textarea rows="6" style="width:100%;font-family:monospace;font-size:12px">${JSON.stringify(tokens)}</textarea>
      <p>Go to: Render Dashboard → Your Service → Environment → Add GOOGLE_TOKENS</p>
    `);
  } catch (err) {
    console.error("Auth error:", err);
    res.status(500).send("Auth failed: " + err.message);
  }
});

// ─── Auth status check ───
router.get("/auth/status", (req, res) => {
  const creds = oauth2Client.credentials;
  res.json({
    authenticated: !!(creds?.access_token || creds?.refresh_token),
    hasRefreshToken: !!creds?.refresh_token,
    hasAccessToken: !!creds?.access_token,
    source: process.env.GOOGLE_TOKENS ? "env" : "file",
  });
});

// ════════════════════════════════
// DRIVE ROUTES
// ════════════════════════════════

// ─── List Files ───
router.get("/files/:folderId", async (req, res) => {
  try {
    const { folderId } = req.params;

    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, webContentLink, thumbnailLink, parents, shared)",
      orderBy: "folder,name",
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const files = response.data.files.map((file) => ({
      ...file,
      iconType: getMimeIcon(file.mimeType),
      isFolder: file.mimeType === "application/vnd.google-apps.folder",
    }));

    files.sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ files, nextPageToken: response.data.nextPageToken || null });
  } catch (error) {
    console.error("List files error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Upload Single File ───
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { folderId } = req.body;
    if (!req.file) return res.status(400).json({ error: "No file provided" });
    if (!folderId) return res.status(400).json({ error: "Folder ID required" });

    const file = await drive.files.create({
      resource: { name: req.file.originalname, parents: [folderId] },
      media: { mimeType: req.file.mimetype, body: fs.createReadStream(req.file.path) },
      fields: "id, name, mimeType, size, createdTime, modifiedTime, webViewLink, thumbnailLink",
      supportsAllDrives: true,
    });

    fs.unlinkSync(req.file.path);
    res.json(file.data);
  } catch (error) {
    console.error("Upload error:", error.message);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: error.message });
  }
});

// ─── Upload Multiple Files ───
router.post("/upload-multiple", upload.array("files", 20), async (req, res) => {
  try {
    const { folderId } = req.body;
    if (!folderId) return res.status(400).json({ error: "Folder ID required" });

    const results = [];
    const errors = [];

    for (const file of req.files) {
      try {
        const driveFile = await drive.files.create({
          resource: { name: file.originalname, parents: [folderId] },
          media: { mimeType: file.mimetype, body: fs.createReadStream(file.path) },
          fields: "id, name, mimeType, size, createdTime, modifiedTime, webViewLink",
          supportsAllDrives: true,
        });
        results.push(driveFile.data);
        fs.unlinkSync(file.path);
      } catch (err) {
        errors.push({ fileName: file.originalname, error: err.message });
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
    }

    res.json({ uploaded: results, errors });
  } catch (error) {
    console.error("Multi-upload error:", error.message);
    req.files?.forEach((f) => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
    res.status(500).json({ error: error.message });
  }
});

// ─── Create Folder ───
router.post("/create-folder", async (req, res) => {
  try {
    const { folderName, parentFolderId } = req.body;
    if (!folderName?.trim()) return res.status(400).json({ error: "Folder name required" });
    if (!parentFolderId) return res.status(400).json({ error: "Parent folder ID required" });

    const folder = await drive.files.create({
      resource: {
        name: folderName.trim(),
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentFolderId],
      },
      fields: "id, name, mimeType, createdTime, modifiedTime, webViewLink",
      supportsAllDrives: true,
    });

    res.json(folder.data);
  } catch (error) {
    console.error("Create folder error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Search ───
router.get("/search", async (req, res) => {
  try {
    const { query, folderId } = req.query;
    if (!query?.trim()) return res.status(400).json({ error: "Query required" });

    let q = `name contains '${query.trim()}' and trashed = false`;
    if (folderId) q = `'${folderId}' in parents and ${q}`;

    const response = await drive.files.list({
      q,
      fields: "files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, thumbnailLink, parents)",
      pageSize: 50,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const files = response.data.files.map((file) => ({
      ...file,
      iconType: getMimeIcon(file.mimeType),
      isFolder: file.mimeType === "application/vnd.google-apps.folder",
    }));

    res.json({ files });
  } catch (error) {
    console.error("Search error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── File Details ───
router.get("/file/:fileId", async (req, res) => {
  try {
    const file = await drive.files.get({
      fileId: req.params.fileId,
      fields: "id, name, mimeType, size, createdTime, modifiedTime, webViewLink, thumbnailLink, description, shared, parents, owners",
      supportsAllDrives: true,
    });
    res.json({
      ...file.data,
      iconType: getMimeIcon(file.data.mimeType),
      isFolder: file.data.mimeType === "application/vnd.google-apps.folder",
    });
  } catch (error) {
    console.error("File details error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Download ───
router.get("/download/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    const fileMeta = await drive.files.get({
      fileId,
      fields: "name, mimeType",
      supportsAllDrives: true,
    });

    const exportMap = {
      "application/vnd.google-apps.document": { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: ".docx" },
      "application/vnd.google-apps.spreadsheet": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: ".xlsx" },
      "application/vnd.google-apps.presentation": { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: ".pptx" },
    };

    const { name: fileName, mimeType } = fileMeta.data;

    if (exportMap[mimeType]) {
      const { mime, ext } = exportMap[mimeType];
      const exportRes = await drive.files.export({ fileId, mimeType: mime }, { responseType: "stream" });
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName + ext)}"`);
      res.setHeader("Content-Type", mime);
      exportRes.data.pipe(res);
    } else {
      const file = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "stream" });
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
      if (mimeType) res.setHeader("Content-Type", mimeType);
      file.data.pipe(res);
    }
  } catch (error) {
    console.error("Download error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Preview ───
router.get("/preview/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    const fileMeta = await drive.files.get({ fileId, fields: "name, mimeType", supportsAllDrives: true });

    const previewable = ["image/", "application/pdf", "text/", "video/", "audio/"];
    if (!previewable.some((t) => fileMeta.data.mimeType?.startsWith(t))) {
      return res.status(400).json({ error: "Not previewable" });
    }

    const file = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "stream" });
    res.setHeader("Content-Type", fileMeta.data.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(fileMeta.data.name)}"`);
    file.data.pipe(res);
  } catch (error) {
    console.error("Preview error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Delete ───
router.delete("/delete/:fileId", async (req, res) => {
  try {
    await drive.files.delete({ fileId: req.params.fileId, supportsAllDrives: true });
    res.json({ success: true });
  } catch (error) {
    console.error("Delete error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Rename ───
router.patch("/rename/:fileId", async (req, res) => {
  try {
    const { newName } = req.body;
    if (!newName?.trim()) return res.status(400).json({ error: "Name required" });

    const file = await drive.files.update({
      fileId: req.params.fileId,
      resource: { name: newName.trim() },
      fields: "id, name, mimeType, modifiedTime",
      supportsAllDrives: true,
    });
    res.json(file.data);
  } catch (error) {
    console.error("Rename error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Copy ───
router.post("/copy/:fileId", async (req, res) => {
  try {
    const { newName, folderId } = req.body;
    const resource = {};
    if (newName) resource.name = newName;
    if (folderId) resource.parents = [folderId];

    const file = await drive.files.copy({
      fileId: req.params.fileId,
      resource,
      fields: "id, name, mimeType, size, createdTime, webViewLink",
      supportsAllDrives: true,
    });
    res.json(file.data);
  } catch (error) {
    console.error("Copy error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Share ───
router.post("/share/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    await drive.permissions.create({
      fileId,
      resource: { role: "reader", type: "anyone" },
      supportsAllDrives: true,
    });

    const file = await drive.files.get({
      fileId,
      fields: "webViewLink",
      supportsAllDrives: true,
    });

    res.json({
      webViewLink: file.data.webViewLink,
      directLink: `https://drive.google.com/file/d/${fileId}/view?usp=sharing`,
    });
  } catch (error) {
    console.error("Share error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Breadcrumb Path ───
router.get("/path/:fileId", async (req, res) => {
  try {
    const { fileId, rootId } = { ...req.params, ...req.query };
    const pathParts = [];
    let currentId = fileId;
    let safety = 0;

    while (currentId && safety < 20) {
      safety++;
      try {
        const file = await drive.files.get({
          fileId: currentId,
          fields: "id, name, parents",
          supportsAllDrives: true,
        });
        pathParts.unshift({ id: file.data.id, name: file.data.name });
        if (rootId && file.data.id === rootId) break;
        currentId = file.data.parents?.[0] || null;
      } catch { break; }
    }

    res.json(pathParts);
  } catch (error) {
    console.error("Path error:", error.message);
    res.status(500).json({ error: "Failed to get path" });
  }
});

// ─── Storage Info ───
router.get("/storage-info/:folderId", async (req, res) => {
  try {
    const { folderId } = req.params;

    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "files(size)",
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const totalSize = response.data.files.reduce((sum, f) => sum + parseInt(f.size || 0), 0);
    res.json({ totalSize, fileCount: response.data.files.length, folderId });
  } catch (error) {
    console.error("Storage info error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;