const express = require("express");
const router = express.Router();
const { ProjectLink } = require("../../Models/DB_Collections");

router.get("/meta", async (req, res) => {
  try {
    const [companies, categories] = await Promise.all([
      ProjectLink.distinct("companyName"),
      ProjectLink.distinct("category"),
    ]);
    res.json({
      success: true,
      companies: companies.sort(),
      categories: categories.filter(Boolean).sort(),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const links = await ProjectLink.find().sort({
      companyName: 1,
      createdAt: -1,
    });

    const grouped = {};
    links.forEach((link) => {
      const key = link.companyName.trim();
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(link);
    });

    const data = Object.keys(grouped)
      .sort((a, b) => a.localeCompare(b))
      .map((companyName) => ({ companyName, links: grouped[companyName] }));

    res.json({ success: true, data });
  } catch (err) {
    console.error("ProjectLink GET error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { companyName, projectName, url, category, addedBy } = req.body; 

    if (!companyName?.trim())
      return res
        .status(400)
        .json({ success: false, message: "companyName is required" });
    if (!projectName?.trim())
      return res
        .status(400)
        .json({ success: false, message: "projectName is required" });
    if (!url?.trim())
      return res
        .status(400)
        .json({ success: false, message: "url is required" });

    const link = await ProjectLink.create({
      companyName: companyName.trim(),
      projectName: projectName.trim(),
      url: url.trim(),
      category: category?.trim() || "", 
      addedBy: addedBy || "",
    });

    res.status(201).json({ success: true, data: link });
  } catch (err) {
    console.error("ProjectLink POST error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { companyName, projectName, url, category } = req.body; 

    const update = {};
    if (companyName !== undefined) update.companyName = companyName.trim();
    if (projectName !== undefined) update.projectName = projectName.trim();
    if (url !== undefined) update.url = url.trim();
    if (category !== undefined) update.category = category.trim();

    const link = await ProjectLink.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true, runValidators: true },
    );

    if (!link)
      return res
        .status(404)
        .json({ success: false, message: "Link not found" });

    res.json({ success: true, data: link });
  } catch (err) {
    console.error("ProjectLink PUT error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const link = await ProjectLink.findByIdAndDelete(req.params.id);
    if (!link)
      return res
        .status(404)
        .json({ success: false, message: "Link not found" });

    res.json({ success: true, message: "Link deleted" });
  } catch (err) {
    console.error("ProjectLink DELETE error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
