const express = require("express");
const router = express.Router();
const { getConnectionWithRetry } = require("../../dataBase/connection");

// Helper to convert 12h time string to MySQL TIME format
const parseTimeString = (timeStr) => {
  const [time, ampm] = timeStr.split(' ');
  let [hours, minutes, seconds] = time.split(':').map(Number);
  if (ampm === 'PM' && hours !== 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

// GET - Fetch attendance
router.get("/", async (req, res) => {
  let connection;
  try {
    const { employee_id, date } = req.query;
    
    if (!employee_id || !date) {
      return res.status(400).json({ status: false, message: "Missing employee_id or date" });
    }
    
    connection = await getConnectionWithRetry();
    
    const [rows] = await new Promise((resolve, reject) => {
      connection.query(
        `SELECT * FROM attendance WHERE employee_id = ? AND login_date = ?`,
        [employee_id, date],
        (err, results) => err ? reject(err) : resolve([results])
      );
    });
    
    res.json({
      status: true,
      data: rows[0] || null
    });
  } catch (error) {
    console.error("GET attendance error:", error);
    res.status(500).json({ status: false, message: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// POST - Record attendance
router.post("/", async (req, res) => {
  let connection;
  try {
    const { employee_id, employee_name, login_date, action, time } = req.body;
    
    if (!employee_id || !employee_name || !login_date || !action || !time) {
      return res.status(400).json({ status: false, message: "Missing required fields" });
    }
    
    const validActions = ['morning_in', 'morning_out', 'afternoon_in', 'afternoon_out'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ status: false, message: "Invalid action" });
    }
    
    connection = await getConnectionWithRetry();
    
    const [existing] = await new Promise((resolve, reject) => {
      connection.query(
        `SELECT * FROM attendance WHERE employee_id = ? AND login_date = ?`,
        [employee_id, login_date],
        (err, results) => err ? reject(err) : resolve([results])
      );
    });
    
    const timeValue = parseTimeString(time);
    
    if (existing.length > 0) {
      await new Promise((resolve, reject) => {
        connection.query(
          `UPDATE attendance SET ${action} = ?, updated_at = CURRENT_TIMESTAMP WHERE employee_id = ? AND login_date = ?`,
          [timeValue, employee_id, login_date],
          (err) => err ? reject(err) : resolve()
        );
      });
    } else {
      await new Promise((resolve, reject) => {
        connection.query(
          `INSERT INTO attendance (employee_id, employee_name, login_date, ${action}) VALUES (?, ?, ?, ?)`,
          [employee_id, employee_name, login_date, timeValue],
          (err) => err ? reject(err) : resolve()
        );
      });
    }
    
    const [updated] = await new Promise((resolve, reject) => {
      connection.query(
        `SELECT * FROM attendance WHERE employee_id = ? AND login_date = ?`,
        [employee_id, login_date],
        (err, results) => err ? reject(err) : resolve([results])
      );
    });
    
    res.json({
      status: true,
      message: `${action.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} recorded successfully`,
      data: updated[0]
    });
  } catch (error) {
    console.error("POST attendance error:", error);
    res.status(500).json({ status: false, message: error.message });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
