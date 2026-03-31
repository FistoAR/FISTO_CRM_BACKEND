const express = require("express");
const router = express.Router();
const db = require("../../dataBase/connection");
const { Project_Details, DayReport } = require("../../Models/DB_Collections");

// ─── HELPER ──────────────────────────────────────────────────────────────────
function formatDate(date) {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ─── GET /today ───────────────────────────────────────────────────────────────
// Returns ALL quotes (celebrations + announcements) for the given date.
// Frontend sends ?date=YYYY-MM-DD — if omitted, falls back to server today.
// Excludes occasion = "Announcement" (those go to /announcements).
router.get("/today", (req, res) => {
  // Use the date passed from the frontend picker, not server "now"
  const dateStr = req.query.date
    ? req.query.date                          // already YYYY-MM-DD
    : new Date().toISOString().split("T")[0]; // fallback

  const query = `
    SELECT
      id,
      date,
      quote,
      occasion,
      image_url AS imageUrl,
      created_at
    FROM quotes
    WHERE DATE(date) = ?
      AND (occasion IS NULL OR occasion != 'Announcement')
    ORDER BY id ASC
  `;

  db.pool.query(query, [dateStr], (err, results) => {
    if (err) {
      console.error("Error fetching celebrations:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    const celebrations = results.map((q) => ({
      id: q.id,
      date: q.date,
      quote: q.quote,
      occasion: q.occasion,
      imageUrl: q.imageUrl,
      description: q.quote,
    }));

    res.json({
      status: true,
      celebrations,
      count: celebrations.length,
    });
  });
});

// ─── GET /announcements ───────────────────────────────────────────────────────
// Returns quotes where occasion = "Announcement" for the given date.
// Frontend sends ?date=YYYY-MM-DD — if omitted, falls back to server today.
router.get("/announcements", (req, res) => {
  const dateStr = req.query.date
    ? req.query.date
    : new Date().toISOString().split("T")[0];

  const query = `
    SELECT
      id,
      date,
      quote,
      occasion,
      image_url AS imageUrl,
      created_at
    FROM quotes
    WHERE DATE(date) = ?
      AND occasion = 'Announcement'
    ORDER BY id ASC
  `;

  db.pool.query(query, [dateStr], (err, results) => {
    if (err) {
      console.error("Error fetching announcements:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    const announcements = results.map((q) => ({
      id: q.id,
      date: q.date,
      quote: q.quote,
      occasion: q.occasion,
      imageUrl: q.imageUrl,
      // Support both "title" and "agenda" field names on the frontend
      title: q.quote,
      agenda: q.quote,
    }));

    res.json({
      status: true,
      announcements,
      count: announcements.length,
    });
  });
});

// ─── GET /meetings ────────────────────────────────────────────────────────────
// Kept for the MeetingsCard. Uses ?date=YYYY-MM-DD.
router.get("/meetings", (req, res) => {
  const dateStr = req.query.date
    ? req.query.date
    : new Date().toISOString().split("T")[0];

  const query = `
    SELECT
      id,
      date,
      quote,
      occasion,
      image_url AS imageUrl,
      created_at
    FROM quotes
    WHERE DATE(date) = ?
    ORDER BY id ASC
  `;

  db.pool.query(query, [dateStr], (err, results) => {
    if (err) {
      console.error("Error fetching meetings:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    const meetings = results.map((q) => ({
      id: q.id,
      date: q.date,
      quote: q.quote,
      occasion: q.occasion,
      imageUrl: q.imageUrl,
    }));

    res.json({
      status: true,
      meetings,
      count: meetings.length,
    });
  });
});

// ─── GET /upcoming ────────────────────────────────────────────────────────────
router.get("/upcoming", (req, res) => {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const nextWeek = new Date();
  nextWeek.setDate(today.getDate() + 7);
  const nextWeekStr = nextWeek.toISOString().split("T")[0];

  const query = `
    SELECT
      id, date, quote, occasion,
      image_url AS imageUrl, created_at
    FROM quotes
    WHERE DATE(date) BETWEEN ? AND ?
    ORDER BY date ASC
  `;

  db.pool.query(query, [todayStr, nextWeekStr], (err, results) => {
    if (err) {
      console.error("Error fetching upcoming:", err);
      return res.status(500).json({ status: false, message: "Database error", error: err.message });
    }

    const upcoming = results.map((q) => {
      const date = new Date(q.date);
      const daysUntil = Math.ceil((date - today) / (1000 * 60 * 60 * 24));
      return { ...q, daysUntil, formattedDate: formatDate(date) };
    });

    res.json({ status: true, upcoming, count: upcoming.length });
  });
});

// ─── GET /recent ──────────────────────────────────────────────────────────────
router.get("/recent", (req, res) => {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const lastMonth = new Date();
  lastMonth.setDate(today.getDate() - 30);
  const lastMonthStr = lastMonth.toISOString().split("T")[0];

  const query = `
    SELECT id, date, quote, occasion, image_url AS imageUrl, created_at
    FROM quotes
    WHERE DATE(date) BETWEEN ? AND ?
    ORDER BY date DESC
    LIMIT 20
  `;

  db.pool.query(query, [lastMonthStr, todayStr], (err, results) => {
    if (err) {
      return res.status(500).json({ status: false, message: "Database error", error: err.message });
    }
    res.json({ status: true, recent: results, count: results.length });
  });
});

// ─── GET /occasion/:type ──────────────────────────────────────────────────────
router.get("/occasion/:type", (req, res) => {
  const { type } = req.params;
  let occasionTypes = [];

  switch (type.toLowerCase()) {
    case "birthdays":      occasionTypes = ["Birthday"]; break;
    case "anniversaries":  occasionTypes = ["Work Anniversary"]; break;
    case "holidays":       occasionTypes = ["Holiday"]; break;
    case "announcements":  occasionTypes = ["Announcement"]; break;
    case "special":        occasionTypes = ["Special Day", "Celebration"]; break;
    default:               occasionTypes = [type];
  }

  const query = `
    SELECT id, date, quote, occasion, image_url AS imageUrl, created_at
    FROM quotes
    WHERE occasion IN (?)
    ORDER BY date DESC
    LIMIT 50
  `;

  db.pool.query(query, [occasionTypes], (err, results) => {
    if (err) {
      return res.status(500).json({ status: false, message: "Database error", error: err.message });
    }
    res.json({ status: true, celebrations: results, count: results.length, occasionType: type });
  });
});

// ─── GET /search ──────────────────────────────────────────────────────────────
router.get("/search", (req, res) => {
  const { q, occasion, month, year } = req.query;

  let query = `
    SELECT id, date, quote, occasion, image_url AS imageUrl, created_at
    FROM quotes WHERE 1=1
  `;
  const params = [];

  if (q) {
    query += ` AND (quote LIKE ? OR occasion LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`);
  }
  if (occasion) { query += ` AND occasion = ?`; params.push(occasion); }
  if (month)    { query += ` AND MONTH(date) = ?`; params.push(month); }
  if (year)     { query += ` AND YEAR(date) = ?`; params.push(year); }

  query += ` ORDER BY date DESC LIMIT 50`;

  db.pool.query(query, params, (err, results) => {
    if (err) {
      return res.status(500).json({ status: false, message: "Database error", error: err.message });
    }
    res.json({ status: true, results, count: results.length });
  });
});

// ─── GET /quote-of-day ────────────────────────────────────────────────────────
router.get("/quote-of-day", (req, res) => {
  const query = `
    SELECT id, date, quote, occasion, image_url AS imageUrl
    FROM quotes ORDER BY RAND() LIMIT 1
  `;
  db.pool.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({ status: false, message: "Database error", error: err.message });
    }
    res.json({ status: true, quote: results[0] || null });
  });
});

// ─── GET /employees-count ─────────────────────────────────────────────────────
router.get("/employees-count", (req, res) => {
  db.pool.query(`SELECT COUNT(*) AS total FROM employees_details`, (err, results) => {
    if (err) {
      return res.status(500).json({ status: false, message: "Database error", error: err.message });
    }
    res.json({ status: true, count: results[0].total });
  });
});

// ─── GET /project-stats ───────────────────────────────────────────────────────
router.get("/project-stats", async (req, res) => {
  try {
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];

    const [total, completed, ongoing, delayed, overdue] = await Promise.all([
      Project_Details.countDocuments(),
      Project_Details.countDocuments({ status: "Completed" }),
      Project_Details.countDocuments({ status: "In Progress" }),
      Project_Details.countDocuments({ status: "In Progress", endDate: { $lt: todayStr } }),
      Project_Details.countDocuments({
        status: { $nin: ["Completed", "Canceled", "Hold"] },
        endDate: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0] },
      }),
    ]);

    res.json({ status: true, stats: { total, completed, ongoing, delayed, overdue } });
  } catch (error) {
    console.error("Error fetching project stats:", error);
    res.status(500).json({ status: false, message: "Error fetching project statistics", error: error.message });
  }
});

// ─── GET /today-tasks ─────────────────────────────────────────────────────────
router.get("/today-tasks", async (req, res) => {
  try {
    const { Tasks } = require("../../Models/DB_Collections");

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const dayReports = await DayReport.find({
      createdAt: { $gte: startOfToday, $lte: endOfToday },
    }).lean();

    if (dayReports.length === 0) {
      return res.json({ status: true, tasks: [], count: 0, message: "No tasks for today" });
    }

    const employeeIds = [...new Set(dayReports.map((r) => r.employeeID))];
    let employeeMap = {};

    if (employeeIds.length > 0) {
      const placeholders = employeeIds.map(() => "?").join(",");
      const employees = await new Promise((resolve, reject) => {
        db.pool.query(
          `SELECT employee_id AS id, employee_name AS name, profile_url AS profile
           FROM employees_details WHERE employee_id IN (${placeholders})`,
          employeeIds,
          (err, results) => (err ? reject(err) : resolve(results || []))
        );
      });
      employees.forEach((emp) => { employeeMap[emp.id] = emp; });
    }

    const taskIds    = [...new Set(dayReports.map((r) => r.taskId).filter(Boolean))];
    const projectIds = [...new Set(dayReports.map((r) => r.projectId).filter(Boolean))];

    const tasks    = await Tasks.find({ _id: { $in: taskIds } }).lean();
    const projects = await Project_Details.find({ _id: { $in: projectIds } }).select("_id projectName colorCode").lean();

    const taskMap    = {};
    const projectMap = {};
    tasks.forEach((t)    => { taskMap[t._id.toString()]    = t; });
    projects.forEach((p) => { projectMap[p._id.toString()] = p; });

    const todayTasks = dayReports.map((report) => {
      const employee    = employeeMap[report.employeeID] || {};
      const task        = taskMap[report.taskId]         || {};
      const project     = projectMap[report.projectId]   || {};
      const employeeName = employee.name || "Unknown";

      let activity   = null;
      let isActivity = false;
      if (report.activityId && task.activities) {
        activity   = task.activities.find((a) => a._id.toString() === report.activityId);
        isActivity = !!activity;
      }

      return {
        id: report._id.toString(),
        employeeID:    report.employeeID,
        employeeName,
        avatar:   employee.profile || null,
        initials: employeeName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2),
        taskId:       report.taskId,
        taskName:     task.taskName || "Unknown Task",
        activityId:   report.activityId,
        activityName: activity?.activityName || null,
        isActivity,
        projectId:    report.projectId,
        projectName:  project.projectName || "Unknown Project",
        projectColor: project.colorCode   || "#3B82F6",
        startDate:    task.startDate || null,
        endDate:      task.endDate   || null,
        type:         isActivity ? "activity" : "task",
        createdAt:    report.createdAt,
      };
    });

    todayTasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ status: true, tasks: todayTasks, count: todayTasks.length });
  } catch (error) {
    console.error("Error fetching today's tasks:", error);
    res.status(500).json({ status: false, message: "Error fetching today's tasks", error: error.message });
  }
});

module.exports = router;