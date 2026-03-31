// driveAccess.routes.js  — mount at /api/drive/access
const express = require("express");
const { DriveAccess } = require("../../Models/DB_Collections"); // adjust path as needed
const { queryWithRetry } = require("../../dataBase/connection"); // adjust path

const router = express.Router();

const ADMIN_ROLES = ["Admin", "SBU", "Project Head"];

// ── Only these designations can be granted access ──────────────────────────────
const ALLOWED_DESIGNATIONS = [
  "3D",
  "Digital Marketing & HR",
  "UI/UX",
  "Software Developer",
];

// ─── helpers ──────────────────────────────────────────────────────────────────

async function getEmployeeInfo(employeeId) {
  if (!employeeId) return null;
  const rows = await queryWithRetry(
    `SELECT designation, team_head as teamHead FROM employees_details WHERE employee_id = ? LIMIT 1`,
    [employeeId]
  );
  if (!rows[0]) return null;
  // Normalize teamHead to boolean
  return { ...rows[0], teamHead: rows[0].teamHead === 1 || rows[0].teamHead === true };
}

async function resolveDirectAccess(employeeId, folderId) {
  const info = await getEmployeeInfo(employeeId);
  if (!info) return "none";
  if (ADMIN_ROLES.includes(info.designation)) return "admin";

  const record = await DriveAccess.findOne({ folderId }).lean();
  if (!record) return "none";

  // Individual grant — works for everyone
  const individualGrant = record.grantedEmployees?.find(
    (g) => g.employeeId === String(employeeId)
  );
  if (individualGrant) return "granted";

  // Designation grant — only for TeamHeads
  if (info.teamHead) {
    const desigGrant = record.grantedDesignations?.find(
      (g) => g.designation === info.designation
    );
    if (desigGrant) return "granted";
  }

  return "none";
}

// ─── GET /access/folder/:folderId ─────────────────────────────────────────────
router.get("/folder/:folderId", async (req, res) => {
  try {
    const { folderId } = req.params;
    const record = await DriveAccess.findOne({ folderId }).lean();
    res.json({ success: true, data: record || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /access/check ────────────────────────────────────────────────────────
router.get("/check", async (req, res) => {
  try {
    const { employeeId, folderId } = req.query;
    if (!employeeId || !folderId)
      return res.status(400).json({ success: false, message: "employeeId and folderId required" });

    const level = await resolveDirectAccess(employeeId, folderId);
    res.json({ success: true, hasAccess: level !== "none", level });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /access/check-with-ancestors ────────────────────────────────────────
router.get("/check-with-ancestors", async (req, res) => {
  try {
    const { employeeId, folderId } = req.query;
    if (!employeeId || !folderId)
      return res.status(400).json({ success: false, message: "employeeId and folderId required" });

    const info = await getEmployeeInfo(employeeId);
    if (!info) return res.json({ hasAccess: false, level: "none" });
    if (ADMIN_ROLES.includes(info.designation))
      return res.json({ hasAccess: true, level: "admin" });

    const isTeamHead = !!info.teamHead;
    const ancestorIds = req.query.ancestorIds ? req.query.ancestorIds.split(",") : [];
    const allFolderIds = [...new Set([folderId, ...ancestorIds])];

    const records = await DriveAccess.find({ folderId: { $in: allFolderIds } }).lean();

    for (const record of records) {
      const individual = record.grantedEmployees?.find(
        (g) => g.employeeId === String(employeeId)
      );
      if (individual) return res.json({ hasAccess: true, level: "granted", grantedAt: record.folderId });

      // Designation grants only apply to TeamHeads, not normal employees
      if (isTeamHead) {
        const desig = record.grantedDesignations?.find(
          (g) => g.designation === info.designation
        );
        if (desig) return res.json({ hasAccess: true, level: "granted", grantedAt: record.folderId });
      }
    }

    return res.json({ hasAccess: false, level: "none" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /access/bulk-check ──────────────────────────────────────────────────
// Check download access for multiple folders (sidebar + subfolder checks).
//
// ACCESS RULES:
//   Admin roles          → always granted
//   TeamHead (team_head=1) → granted if designation OR individual grant matches
//   Normal employee       → ONLY granted if individually granted (NOT by designation)
//                           Designation grants are TeamHead-level only.
router.post("/bulk-check", async (req, res) => {
  try {
    const { employeeId, folderIds } = req.body;
    if (!employeeId || !Array.isArray(folderIds))
      return res.status(400).json({ success: false, message: "employeeId and folderIds[] required" });

    const info = await getEmployeeInfo(employeeId);
    if (!info) return res.json({ success: true, data: {} });

    // Admins always have full access
    if (ADMIN_ROLES.includes(info.designation)) {
      const data = {};
      folderIds.forEach((id) => (data[id] = { hasAccess: true, level: "admin" }));
      return res.json({ success: true, data });
    }

    const isTeamHead = !!info.teamHead;
    const records = await DriveAccess.find({ folderId: { $in: folderIds } }).lean();
    const recordMap = {};
    records.forEach((r) => (recordMap[r.folderId] = r));

    const data = {};
    for (const folderId of folderIds) {
      const record = recordMap[folderId];
      if (!record) { data[folderId] = { hasAccess: false, level: "none" }; continue; }

      // Individual grant — works for EVERYONE (normal employee + TeamHead)
      const individual = record.grantedEmployees?.find(
        (g) => g.employeeId === String(employeeId)
      );
      if (individual) { data[folderId] = { hasAccess: true, level: "granted" }; continue; }

      // Designation grant — ONLY for TeamHeads, NOT for normal employees
      if (isTeamHead) {
        const desig = record.grantedDesignations?.find(
          (g) => g.designation === info.designation
        );
        if (desig) { data[folderId] = { hasAccess: true, level: "granted" }; continue; }
      }

      data[folderId] = { hasAccess: false, level: "none" };
    }

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /access/bulk-check-visibility ──────────────────────────────────────
// NEW: Returns adminOnly flag for each folder so non-admins can filter hidden folders
// Body: { folderIds: [...] }
// Does NOT require employeeId — just returns visibility metadata
router.post("/bulk-check-visibility", async (req, res) => {
  try {
    const { folderIds } = req.body;
    if (!Array.isArray(folderIds))
      return res.status(400).json({ success: false, message: "folderIds[] required" });

    const records = await DriveAccess.find(
      { folderId: { $in: folderIds } },
      { folderId: 1, adminOnly: 1 }
    ).lean();

    const data = {};
    // Default all to not adminOnly
    folderIds.forEach((id) => (data[id] = { adminOnly: false }));
    // Override with actual values
    records.forEach((r) => { data[r.folderId] = { adminOnly: !!r.adminOnly }; });

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /access/folder ──────────────────────────────────────────────────────
router.post("/folder", async (req, res) => {
  try {
    const { folderId, folderName, createdBy } = req.body;
    if (!folderId) return res.status(400).json({ success: false, message: "folderId required" });

    const existing = await DriveAccess.findOne({ folderId });
    if (existing) return res.json({ success: true, data: existing });

    const record = new DriveAccess({
      folderId,
      folderName: folderName || "",
      createdBy: createdBy || "",
      grantedEmployees: [],
      grantedDesignations: [],
      adminOnly: false,
    });
    await record.save();
    res.status(201).json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── PATCH /access/set-admin-only ────────────────────────────────────────────
// NEW: Toggle folder visibility — admin-only or visible to all
// Body: { folderId, adminOnly: true|false }
router.patch("/set-admin-only", async (req, res) => {
  try {
    const { folderId, adminOnly } = req.body;
    if (!folderId || typeof adminOnly !== "boolean")
      return res.status(400).json({ success: false, message: "folderId and adminOnly (boolean) required" });

    const record = await DriveAccess.findOneAndUpdate(
      { folderId },
      {
        $set: { adminOnly },
        $setOnInsert: { folderId, folderName: "", createdBy: "", grantedEmployees: [], grantedDesignations: [] },
      },
      { upsert: true, new: true }
    );
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── PATCH /access/grant-designation ─────────────────────────────────────────
router.patch("/grant-designation", async (req, res) => {
  try {
    const { folderId, designation, grantedBy } = req.body;
    if (!folderId || !designation)
      return res.status(400).json({ success: false, message: "folderId and designation required" });

    // Only allow the pre-defined designations
    if (!ALLOWED_DESIGNATIONS.includes(designation))
      return res.status(400).json({ success: false, message: `Designation must be one of: ${ALLOWED_DESIGNATIONS.join(", ")}` });

    const record = await DriveAccess.findOneAndUpdate(
      { folderId, "grantedDesignations.designation": { $ne: designation } },
      {
        $push: { grantedDesignations: { designation, grantedBy: grantedBy || "", grantedAt: new Date() } },
        $setOnInsert: { folderId, folderName: "", createdBy: grantedBy || "", adminOnly: false },
      },
      { upsert: true, new: true }
    );
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── PATCH /access/revoke-designation ────────────────────────────────────────
router.patch("/revoke-designation", async (req, res) => {
  try {
    const { folderId, designation } = req.body;
    if (!folderId || !designation)
      return res.status(400).json({ success: false, message: "folderId and designation required" });

    const record = await DriveAccess.findOneAndUpdate(
      { folderId },
      { $pull: { grantedDesignations: { designation } } },
      { new: true }
    );
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── PATCH /access/grant-employee ────────────────────────────────────────────
router.patch("/grant-employee", async (req, res) => {
  try {
    const { folderId, employeeId, grantedBy } = req.body;
    if (!folderId || !employeeId)
      return res.status(400).json({ success: false, message: "folderId and employeeId required" });

    const record = await DriveAccess.findOneAndUpdate(
      { folderId, "grantedEmployees.employeeId": { $ne: String(employeeId) } },
      {
        $push: { grantedEmployees: { employeeId: String(employeeId), grantedBy: grantedBy || "", grantedAt: new Date() } },
        $setOnInsert: { folderId, folderName: "", createdBy: grantedBy || "", adminOnly: false },
      },
      { upsert: true, new: true }
    );
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── PATCH /access/revoke-employee ───────────────────────────────────────────
router.patch("/revoke-employee", async (req, res) => {
  try {
    const { folderId, employeeId } = req.body;
    if (!folderId || !employeeId)
      return res.status(400).json({ success: false, message: "folderId and employeeId required" });

    const record = await DriveAccess.findOneAndUpdate(
      { folderId },
      { $pull: { grantedEmployees: { employeeId: String(employeeId) } } },
      { new: true }
    );
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DELETE /access/folder/:folderId ─────────────────────────────────────────
router.delete("/folder/:folderId", async (req, res) => {
  try {
    await DriveAccess.deleteOne({ folderId: req.params.folderId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /access/team-members ────────────────────────────────────────────────
// TeamHead gets all non-teamhead members of their designation
router.get("/team-members", async (req, res) => {
  try {
    const { designation } = req.query;
    if (!designation)
      return res.status(400).json({ success: false, message: "designation required" });

    const employees = await queryWithRetry(
      `SELECT employee_id as id, employee_name as name, profile_url as profile, designation
       FROM employees_details
       WHERE designation = ? AND working_status = 'Active' AND team_head = 0
       ORDER BY employee_name ASC`,
      [designation]
    );
    res.json({ success: true, data: employees });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /access/all-designations ────────────────────────────────────────────
// Returns only the ALLOWED_DESIGNATIONS (not all designations from DB)
router.get("/all-designations", async (req, res) => {
  try {
    res.json({ success: true, data: ALLOWED_DESIGNATIONS });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;