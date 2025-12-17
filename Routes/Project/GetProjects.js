// Routes/Project/GetProjects.js  (replace existing file)
const express = require("express");
const router = express.Router();
const db = require("../../dataBase/connection");

// safe JSON parse
const safeParse = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return v; }
};

router.get("/", (req, res) => {
  const search = req.query.search || "";
  const empID = req.query.empID || "";

  // select all columns so we never hit unknown-column error
  let sql = `SELECT * FROM Projects WHERE 1=1`;
  const params = [];

  if (search) {
    sql += ` AND (projectName LIKE ? OR companyName LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }
  if (empID) {
    sql += ` AND (employeeID = ? OR accessGrantedTo LIKE ?)`;
    params.push(empID, `%${empID}%`);
  }

  sql += ` ORDER BY createdAt DESC LIMIT 2000;`;

  db.pool.query(sql, params, (err, results) => {
    if (err) {
      console.error("GET /api/projects DB error:", {
        code: err.code,
        message: err.message,
        sqlMessage: err.sqlMessage,
        sql: err.sql,
      });
      return res.status(500).json({ success: false, message: "DB error", error: err.message });
    }

    const data = (results || []).map((row) => {
      // try to parse whatever JSON-like columns may exist without assuming names
      return {
        ...row,
        colorCode: safeParse(row.colorCode) || (row.color ? { code: row.color, name: null } : null),
        accessGrantedTo: safeParse(row.accessGrantedTo) || safeParse(row.access_granted_to) || [],
        teamHead: safeParse(row.teamHead) || safeParse(row.team_head) || null,
        percentage: typeof row.percentage === "number" ? row.percentage : Number(row.percentage || 0),
      };
    });

    res.json({ success: true, data });
  });
});

// router.get("/:id", (req, res) => {
//   const id = req.params.id;
//   const sql = `SELECT * FROM Projects WHERE id = ? LIMIT 1;`;
//   db.pool.query(sql, [id], (err, results) => {
//     if (err) {
//       console.error("GET /api/projects/:id DB error:", {
//         code: err.code,
//         message: err.message,
//         sqlMessage: err.sqlMessage,
//         sql: err.sql,
//       });
//       return res.status(500).json({ success: false, message: "DB error", error: err.message });
//     }
//     if (!results || results.length === 0) {
//       return res.status(404).json({ success: false, message: "Project not found" });
//     }
//     const row = results[0];
//     res.json({
//       success: true,
//       data: {
//         ...row,
//         colorCode: safeParse(row.colorCode) || safeParse(row.color) || null,
//         accessGrantedTo: safeParse(row.accessGrantedTo) || safeParse(row.access_granted_to) || [],
//         teamHead: safeParse(row.teamHead) || safeParse(row.team_head) || null,
//         percentage: typeof row.percentage === "number" ? row.percentage : Number(row.percentage || 0),
//       },
//     });
//   });
// });

module.exports = router;
