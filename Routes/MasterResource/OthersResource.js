const express = require("express");
const router = express.Router();
const { OthersResource } = require("../../Models/DB_Collections");

// Helper to get or create the single document
const getDoc = async () => {
  let doc = await OthersResource.findOne();
  if (!doc) {
    doc = await OthersResource.create({ containers: [] });
  }
  return doc;
};

// GET all containers
router.get("/", async (req, res) => {
  try {
    const doc = await getDoc();
    res.json({ success: true, data: doc.containers });
  } catch (err) {
    console.error("GET /notes error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT save all containers (full replace)
router.put("/", async (req, res) => {
  try {
    const { containers } = req.body;
    const doc = await getDoc();
    doc.containers = containers;
    await doc.save();
    res.json({ success: true, data: doc.containers });
  } catch (err) {
    console.error("PUT /notes error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST add a container
router.post("/container", async (req, res) => {
  try {
    const { container } = req.body;
    const doc = await getDoc();
    doc.containers.push(container);
    await doc.save();
    res.json({ success: true, data: doc.containers });
  } catch (err) {
    console.error("POST /container error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT update a container
router.put("/container/:containerId", async (req, res) => {
  try {
    const { containerId } = req.params;
    const { updates } = req.body;
    const doc = await getDoc();

    const container = doc.containers.find((c) => c.containerId === containerId);
    if (!container) {
      return res.status(404).json({ success: false, message: "Container not found" });
    }

    Object.assign(container, updates);
    await doc.save();
    res.json({ success: true, data: doc.containers });
  } catch (err) {
    console.error("PUT /container error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE a container
router.delete("/container/:containerId", async (req, res) => {
  try {
    const { containerId } = req.params;
    const doc = await getDoc();
    doc.containers = doc.containers.filter((c) => c.containerId !== containerId);
    await doc.save();
    res.json({ success: true, data: doc.containers });
  } catch (err) {
    console.error("DELETE /container error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST add a section
router.post("/container/:containerId/section", async (req, res) => {
  try {
    const { containerId } = req.params;
    const { section } = req.body;
    const doc = await getDoc();

    const container = doc.containers.find((c) => c.containerId === containerId);
    if (!container) {
      return res.status(404).json({ success: false, message: "Container not found" });
    }

    container.sections.push(section);
    await doc.save();
    res.json({ success: true, data: doc.containers });
  } catch (err) {
    console.error("POST /section error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT update a section
router.put("/container/:containerId/section/:sectionId", async (req, res) => {
  try {
    const { containerId, sectionId } = req.params;
    const { updates } = req.body;
    const doc = await getDoc();

    const container = doc.containers.find((c) => c.containerId === containerId);
    if (!container) {
      return res.status(404).json({ success: false, message: "Container not found" });
    }

    const section = container.sections.find((s) => s.sectionId === sectionId);
    if (!section) {
      return res.status(404).json({ success: false, message: "Section not found" });
    }

    Object.assign(section, updates);
    await doc.save();
    res.json({ success: true, data: doc.containers });
  } catch (err) {
    console.error("PUT /section error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE a section
router.delete("/container/:containerId/section/:sectionId", async (req, res) => {
  try {
    const { containerId, sectionId } = req.params;
    const doc = await getDoc();

    const container = doc.containers.find((c) => c.containerId === containerId);
    if (!container) {
      return res.status(404).json({ success: false, message: "Container not found" });
    }

    container.sections = container.sections.filter((s) => s.sectionId !== sectionId);
    await doc.save();
    res.json({ success: true, data: doc.containers });
  } catch (err) {
    console.error("DELETE /section error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST add a field
router.post("/container/:containerId/section/:sectionId/field", async (req, res) => {
  try {
    const { containerId, sectionId } = req.params;
    const { field } = req.body;
    const doc = await getDoc();

    const container = doc.containers.find((c) => c.containerId === containerId);
    if (!container) {
      return res.status(404).json({ success: false, message: "Container not found" });
    }

    const section = container.sections.find((s) => s.sectionId === sectionId);
    if (!section) {
      return res.status(404).json({ success: false, message: "Section not found" });
    }

    section.fields.push(field);
    await doc.save();
    res.json({ success: true, data: doc.containers });
  } catch (err) {
    console.error("POST /field error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT update a field
router.put("/container/:containerId/section/:sectionId/field/:fieldId", async (req, res) => {
  try {
    const { containerId, sectionId, fieldId } = req.params;
    const { updates } = req.body;
    const doc = await getDoc();

    const container = doc.containers.find((c) => c.containerId === containerId);
    if (!container) {
      return res.status(404).json({ success: false, message: "Container not found" });
    }

    const section = container.sections.find((s) => s.sectionId === sectionId);
    if (!section) {
      return res.status(404).json({ success: false, message: "Section not found" });
    }

    const field = section.fields.find((f) => f.fieldId === fieldId);
    if (!field) {
      return res.status(404).json({ success: false, message: "Field not found" });
    }

    Object.assign(field, updates);
    await doc.save();
    res.json({ success: true, data: doc.containers });
  } catch (err) {
    console.error("PUT /field error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE a field
router.delete("/container/:containerId/section/:sectionId/field/:fieldId", async (req, res) => {
  try {
    const { containerId, sectionId, fieldId } = req.params;
    const doc = await getDoc();

    const container = doc.containers.find((c) => c.containerId === containerId);
    if (!container) {
      return res.status(404).json({ success: false, message: "Container not found" });
    }

    const section = container.sections.find((s) => s.sectionId === sectionId);
    if (!section) {
      return res.status(404).json({ success: false, message: "Section not found" });
    }

    section.fields = section.fields.filter((f) => f.fieldId !== fieldId);
    await doc.save();
    res.json({ success: true, data: doc.containers });
  } catch (err) {
    console.error("DELETE /field error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT reorder containers
router.put("/reorder", async (req, res) => {
  try {
    const { containerIds } = req.body;
    const doc = await getDoc();

    const reordered = containerIds
      .map((id) => doc.containers.find((c) => c.containerId === id))
      .filter(Boolean);

    doc.containers = reordered;
    await doc.save();
    res.json({ success: true, data: doc.containers });
  } catch (err) {
    console.error("PUT /reorder error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;