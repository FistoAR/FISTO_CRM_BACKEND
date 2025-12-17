const express = require('express');
const router = express.Router();
const db = require('../../dataBase/connection');

router.post("/", (req, res) => {
  console.log("POST /api/login called");
  const { emailOrUsername, password, rememberMe } = req.body;

  if (!emailOrUsername || !password) {
    return res.status(400).json({
      status: false,
      message: "Employee ID/Email and password are required",
    });
  }

  const query = `
    SELECT 
      id, employee_id, employee_name, designation, team_head,
      email_personal, email_official, password, profile_url,
      working_status, employment_type
    FROM employees_details 
    WHERE (employee_id = ? OR email_personal = ? OR email_official = ?)
    LIMIT 1
  `;

  db.pool.query(query, [emailOrUsername, emailOrUsername, emailOrUsername], (err, results) => {  // ← CHANGED
    if (err) {
      console.error("Login query error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error occurred",
        error: err.message,
      });
    }

    if (results.length === 0) {
      return res.status(401).json({
        status: false,
        message: "Invalid Employee ID/Email or password",
      });
    }

    const user = results[0];

    if (password !== user.password) {
      return res.status(401).json({
        status: false,
        message: "Invalid Employee ID/Email or password",
      });
    }

    console.log(`User ${user.employee_id} logged in successfully`);

    res.json({
      status: true,
      message: `Welcome back, ${user.employee_name}!`,
      data: {
        userName: user.employee_id,
        employeeName: user.employee_name,
        designation: user.designation,
        teamHead: Boolean(user.team_head),
        emailOfficial: user.email_official || user.email_personal,
        profile: user.profile_url,
        employmentType: user.employment_type,
      },
    });
  });
});

module.exports = router;
