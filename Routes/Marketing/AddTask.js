// Routes/Marketing/AddTask.js
const express = require("express");
const router = express.Router();
const db = require("../../dataBase/connection");

// GET all tasks 
router.get("/", (req, res) => {
  console.log("GET /api/marketing-tasks called");

  const { task_type, seq_range } = req.query;

  let query = `
    SELECT
      marketing_task_id,
      task_code,
      task_name,
      task_description,
      task_type,
      seq_range,
      employee_id,
      employee_name,
      category,
      deadline_time,
      deadline_date,
      assign_status,
      task_date,
      created_at,
      updated_at,
      created_by,
      is_active
    FROM marketing_task
    WHERE is_active = 1
  `;
  const params = [];

  if (task_type) {
    query += " AND task_type = ?";
    params.push(task_type);
  }
  if (seq_range) {
    query += " AND seq_range = ?";
    params.push(seq_range);
  }

  query += " ORDER BY created_at DESC";

  db.pool.query(query, params, (err, results) => {
    if (err) {
      console.error("Fetch error:", err);
      return res.status(500).json({
        status: false,
        message: "DB error",
        error: err.message,
      });
    }

    res.json(results);
  });
});


// POST - create task for MULTIPLE employees
router.post("/", (req, res) => {
  console.log("POST /api/marketing-tasks called");
  const data = req.body;

  const employees = Array.isArray(data.employees) 
    ? data.employees 
    : [{ 
        employee_id: data.employee_id || null, 
        employee_name: data.employee_name 
      }].filter(emp => emp.employee_name);

  if (!data.task_name || !data.task_description || !data.task_type || employees.length === 0) {
    return res.status(400).json({
      status: false,
      message: "task_name, task_description, task_type and at least one employee are required",
    });
  }

  const taskType = data.task_type === "SEQUENTIAL" ? "SEQUENTIAL" : "CONCURRENT";
  const seqRange = taskType === "SEQUENTIAL"
    ? data.seq_range === "WEEKLY" ? "WEEKLY" 
      : data.seq_range === "MONTHLY" ? "MONTHLY" 
      : "TODAY"
    : null;

  const baseTaskData = [
    data.task_code || null,
    data.task_name,
    data.task_description,
    taskType,
    seqRange,
    data.category || null,
    data.assign_status === "HOLD" ? "HOLD" : "ASSIGN",
    data.created_by || null,
    data.task_date || null,
    data.deadline_time || null,  // NEW: deadline time
    data.deadline_date || null,  // NEW: deadline date
  ];

  const query = `
    INSERT INTO marketing_task
      (task_code, task_name, task_description,
       task_type, seq_range,
       employee_id, employee_name,
       category, assign_status,
       created_by, task_date, deadline_time, deadline_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const insertPromises = employees.map(emp => {
    const params = [
      ...baseTaskData.slice(0, 5),  // task_code to seq_range
      emp.employee_id || null,
      emp.employee_name,
      ...baseTaskData.slice(5)      // category to deadline_date
    ];
    
    return new Promise((resolve, reject) => {
      db.pool.query(query, params, (err, result) => {
        if (err) {
          console.error("Insert error for employee", emp.employee_name, ":", err);
          reject(err);
        } else {
          resolve({ id: result.insertId, employee_name: emp.employee_name });
        }
      });
    });
  });

  Promise.all(insertPromises)
    .then(results => {
      console.log(`Task added for ${results.length} employees:`, results.map(r => r.id));
      res.status(201).json({
        status: true,
        message: `Task added successfully for ${results.length} employee${results.length > 1 ? 's' : ''}`,
        ids: results.map(r => r.id)
      });
    })
    .catch(err => {
      res.status(500).json({
        status: false,
        message: "DB error while adding tasks",
        error: err.message,
      });
    });
});


// PUT - update task
router.put("/:id", (req, res) => {
  console.log(`PUT /api/marketing-tasks/${req.params.id} called`);
  const { id } = req.params;
  const data = req.body;

  const taskType = data.task_type === "SEQUENTIAL" ? "SEQUENTIAL" : "CONCURRENT";
  const seqRange =
    taskType === "SEQUENTIAL"
      ? data.seq_range === "WEEKLY"
        ? "WEEKLY"
        : data.seq_range === "MONTHLY"
        ? "MONTHLY"
        : "TODAY"
      : null;

  const query = `
    UPDATE marketing_task SET
      task_code = ?,
      task_name = ?,
      task_description = ?,
      task_type = ?,
      seq_range = ?,
      employee_id = ?,
      employee_name = ?,
      category = ?,
      assign_status = ?,
      deadline_time = ?,
      deadline_date = ?
    WHERE marketing_task_id = ?
  `;

  const params = [
    data.task_code || null,
    data.task_name || null,
    data.task_description || null,
    taskType,
    seqRange,
    data.employee_id || null,
    data.employee_name || null,
    data.category || null,
    data.assign_status === "HOLD" ? "HOLD" : "ASSIGN",
    data.deadline_time || null,  // NEW
    data.deadline_date || null,  // NEW
    id,
  ];

  db.pool.query(query, params, (err, result) => {
    if (err) {
      console.error("Update error:", err);
      return res.status(500).json({
        status: false,
        message: "DB error",
        error: err.message,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        status: false,
        message: "Task not found",
      });
    }

    res.json({
      status: true,
      message: "Task updated successfully",
    });
  });
});

// DELETE - hard delete
router.delete("/:id", (req, res) => {
  const { id } = req.params;
  console.log("Hard deleting marketing task:", id);

  const query = "DELETE FROM marketing_task WHERE marketing_task_id = ?";

  db.pool.query(query, [id], (err, result) => {
    if (err) {
      console.error("Delete error:", err);
      return res.status(500).json({
        status: false,
        message: "DB error",
        error: err.message,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        status: false,
        message: "Task not found",
      });
    }

    res.json({
      status: true,
      message: "Task deleted permanently",
    });
  });
});


module.exports = router;
