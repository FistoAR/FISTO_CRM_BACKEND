const express = require("express");
const router = express.Router();
const db = require("../../dataBase/connection");

// Helper: format incoming date (Date or string) -> YYYY-MM-DD for MySQL
const formatDateForMySQL = (dateValue) => {
  if (!dateValue) return null;
  let date;
  if (dateValue instanceof Date) {
    date = dateValue;
  } else if (typeof dateValue === "string") {
    date = new Date(dateValue);
  } else {
    return null;
  }
  if (isNaN(date.getTime())) return null;
  return date.toISOString().split("T")[0];
};

// Helper: Convert IST datetime string to MySQL datetime format
const parseISTDateTime = (istString) => {
  if (!istString) return null;
  
  try {
    // Format: "16/12/2025, 15:31:45" (from toLocaleString)
    const [datePart, timePart] = istString.split(", ");
    const [day, month, year] = datePart.split("/");
    const [hour, minute, second] = timePart.split(":");
    
    // MySQL format: YYYY-MM-DD HH:MM:SS
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`;
  } catch (err) {
    console.error("Error parsing IST datetime:", err);
    return null;
  }
};

// GET tasks for Report page - filtered by employee and date
router.get("/", (req, res) => {
  console.log("GET /api/marketing/report-tasks called");

  const { employee_name, task_type, seq_range, task_date } = req.query;

  let query = `
    SELECT
      mt.marketing_task_id,
      mt.task_code,
      mt.task_name,
      mt.task_description,
      mt.task_type,
      mt.seq_range,
      mt.employee_id,
      mt.employee_name,
      mt.category,
      mt.deadline_time,
      mt.deadline_date,
      mt.assign_status,
      mt.task_date,
      mt.created_at,
      mt.updated_at,
      mt.is_active,
      mte.id as mte_id,
      mte.progress as emp_progress,
      mte.status as emp_status,
      mte.time_range as emp_time_range,
      mte.category as emp_category,
      mte.deadline_time as emp_deadline_time,
      mte.deadline_date as emp_deadline_date
    FROM marketing_task mt
    LEFT JOIN marketing_task_emp mte
      ON mt.marketing_task_id = mte.task_id
      AND (
        (mt.task_type = 'CONCURRENT' AND mte.time_range = 'today')
        OR
        (mt.task_type = 'SEQUENTIAL' AND mt.seq_range = 'TODAY' AND mte.time_range = 'today')
        OR
        (mt.task_type = 'SEQUENTIAL' AND mt.seq_range = 'WEEKLY' AND mte.time_range = 'weekly')
        OR
        (mt.task_type = 'SEQUENTIAL' AND mt.seq_range = 'MONTHLY' AND mte.time_range = 'monthly')
      )
    WHERE mt.is_active = 1
      AND mt.assign_status = 'ASSIGN'
  `;

  const params = [];

  if (employee_name) {
    query += " AND mt.employee_name = ?";
    params.push(employee_name);
  }

  if (task_type) {
    query += " AND mt.task_type = ?";
    params.push(task_type);
  }

  if (task_date) {
    if (task_type === "CONCURRENT") {
      query +=
        " AND (mt.task_date = ? OR (mt.task_date < ? AND COALESCE(mte.status, 'In Progress') = 'In Progress'))";
      params.push(task_date, task_date);
    } else {
      query += " AND mt.task_date = ?";
      params.push(task_date);
    }
  }

  if (seq_range) {
    query += " AND mt.seq_range = ?";
    params.push(seq_range);
  }

  query += " ORDER BY mt.created_at DESC";

  db.pool.query(query, params, (err, results) => {
    if (err) {
      console.error("Fetch report tasks error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.json({
      status: true,
      tasks: results,
    });
  });
});

// POST /api/marketing/report-tasks/:id/report
router.post("/:id/report", (req, res) => {
  console.log("POST /api/marketing/report-tasks/:id/report called");
  const taskId = req.params.id;
  const { progress, status, remarks, employee_id, employee_name, submitted_datetime } = req.body;

  // Validate required fields
  if (
    progress === undefined ||
    progress === null ||
    !status ||
    !remarks ||
    !String(remarks).trim() ||
    !employee_id ||
    !employee_name
  ) {
    return res.status(400).json({
      status: false,
      message: "progress, status, remarks, employee_id, employee_name are required",
    });
  }

  const pct = Number(progress);
  if (Number.isNaN(pct) || pct < 0 || pct > 100) {
    return res.status(400).json({
      status: false,
      message: "progress must be between 0 and 100",
    });
  }

  if (status === "Completed" && pct !== 100) {
    return res.status(400).json({
      status: false,
      message: "Completed status requires 100% progress",
    });
  }

  // Parse the submitted datetime
  const submittedAt = submitted_datetime ? parseISTDateTime(submitted_datetime) : null;
  if (!submittedAt) {
    return res.status(400).json({
      status: false,
      message: "Invalid datetime format",
    });
  }

  console.log("Parsed datetime:", submittedAt);

  db.pool.getConnection((err, connection) => {
    if (err) {
      console.error("Connection error", err);
      return res.status(500).json({
        status: false,
        message: "Database connection error",
      });
    }

    connection.beginTransaction(async (txErr) => {
      if (txErr) {
        connection.release();
        console.error("Transaction error", txErr);
        return res.status(500).json({
          status: false,
          message: "Transaction error",
        });
      }

      const q = (sql, params = []) =>
        new Promise((resolve, reject) => {
          connection.query(sql, params, (e, r) => (e ? reject(e) : resolve(r)));
        });

      try {
        // 1) Get task from marketing_task
        const taskRows = await q(
          `
          SELECT 
            marketing_task_id,
            task_name, 
            task_description, 
            task_date, 
            task_type, 
            seq_range,
            category,
            deadline_time,
            deadline_date,
            created_at
          FROM marketing_task
          WHERE marketing_task_id = ?
        `,
          [taskId]
        );

        if (!taskRows.length) {
          throw new Error("Task not found");
        }

        const task = taskRows[0];

        // 2) Determine taskDate and normalize
        let taskDate = task.task_date;
        if (!taskDate) {
          taskDate = task.created_at || new Date();
        }
        taskDate = formatDateForMySQL(taskDate);
        if (!taskDate) throw new Error("Unable to determine valid task date");

        // 3) Map seq_range to time_range
        let timeRange = "today";
        if (task.task_type === "SEQUENTIAL") {
          if (task.seq_range === "WEEKLY") timeRange = "weekly";
          else if (task.seq_range === "MONTHLY") timeRange = "monthly";
          else timeRange = "today";
        } else if (task.task_type === "CONCURRENT") {
          timeRange = "today";
        }

        // 4) Check if row exists in marketing_task_emp
        const empRows = await q(
          `
          SELECT id, progress
          FROM marketing_task_emp
          WHERE task_id = ? AND time_range = ?
        `,
          [taskId, timeRange]
        );

        let empTaskId;
        if (empRows.length > 0) {
          empTaskId = empRows[0].id;
          console.log("Found existing marketing_task_emp row:", empTaskId);
        } else {
          console.log("No marketing_task_emp row found, creating new one");
          const insEmp = await q(
            `
              INSERT INTO marketing_task_emp
                (task_id, task_name, task_description, date, time_range, 
                progress, status, category, deadline_time, deadline_date, 
                employee_id, employee_name, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
              taskId,
              task.task_name,
              task.task_description,
              taskDate,
              timeRange,
              0,
              "In Progress",
              task.category || null,
              task.deadline_time || null,
              task.deadline_date || null,
              employee_id,
              employee_name,
              submittedAt, // Use client datetime
              submittedAt, // Use client datetime
            ]
          );

          empTaskId = insEmp.insertId;
          console.log("Created marketing_task_emp with id:", empTaskId);
        }

        // 5) Insert into marketing_history_report
        await q(
          `
          INSERT INTO marketing_history_report
            (task_id, employee_id, employee_name, progress, status, remarks, submitted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
          [empTaskId, employee_id, employee_name, pct, status, remarks, submittedAt]
        );

        console.log("Inserted history report for task_id:", empTaskId);

        // 6) Update marketing_task_emp
        await q(
          `
          UPDATE marketing_task_emp
          SET progress = ?, status = ?, updated_at = ?
          WHERE id = ?
        `,
          [pct, status, submittedAt, empTaskId]
        );

        console.log("Updated marketing_task_emp with client datetime");

        connection.commit((commitErr) => {
          connection.release();
          if (commitErr) {
            console.error("Commit error", commitErr);
            return res.status(500).json({
              status: false,
              message: "Commit error",
            });
          }

          console.log("Transaction committed successfully");
          res.json({
            status: true,
            message: "Report saved successfully",
          });
        });
      } catch (error) {
        console.error("Report save error:", error);
        connection.rollback(() => {
          connection.release();
          res.status(500).json({
            status: false,
            message: error.message || "Failed to save report",
          });
        });
      }
    });
  });
});

// GET /api/marketing/report-tasks/:id/history
router.get("/:id/history", (req, res) => {
  console.log("GET /api/marketing/report-tasks/:id/history called");
  const taskId = req.params.id;
  const query = `
    SELECT 
      mhr.id,
      mhr.task_id as emp_task_id,
      mhr.employee_id,
      mhr.employee_name,
      mhr.progress,
      mhr.status,
      mhr.remarks,
      mhr.submitted_at,
      mte.task_name,
      mte.task_description,
      mte.time_range
    FROM marketing_history_report mhr
    INNER JOIN marketing_task_emp mte ON mhr.task_id = mte.id
    INNER JOIN marketing_task mt ON mte.task_id = mt.marketing_task_id
    WHERE mt.marketing_task_id = ?
    ORDER BY mhr.submitted_at DESC
  `;

  db.pool.query(query, [taskId], (err, results) => {
    if (err) {
      console.error("Fetch history error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.json({
      status: true,
      history: results,
    });
  });
});

// Other routes remain the same...
router.get("/stats", (req, res) => {
  console.log("GET /api/marketing/report-tasks/stats called");
  const { employee_name } = req.query;

  if (!employee_name) {
    return res.status(400).json({
      status: false,
      message: "employee_name is required",
    });
  }

  const query = `
    SELECT 
      COUNT(*) as total_tasks,
      SUM(CASE WHEN mte.status = 'Completed' THEN 1 ELSE 0 END) as completed_tasks,
      SUM(CASE WHEN mte.status = 'In Progress' THEN 1 ELSE 0 END) as in_progress_tasks,
      AVG(CASE WHEN mte.status = 'Completed' THEN mte.progress END) as avg_completion
    FROM marketing_task mt
    LEFT JOIN marketing_task_emp mte ON mt.marketing_task_id = mte.task_id
    WHERE mt.employee_name = ?
      AND mt.is_active = 1
      AND mt.assign_status = 'ASSIGN'
  `;

  db.pool.query(query, [employee_name], (err, results) => {
    if (err) {
      console.error("Fetch stats error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.json({
      status: true,
      stats: results[0] || {
        total_tasks: 0,
        completed_tasks: 0,
        in_progress_tasks: 0,
        avg_completion: 0,
      },
    });
  });
});

router.put("/:id/update", (req, res) => {
  console.log("PUT /api/marketing/report-tasks/:id/update called");
  const taskId = req.params.id;
  const { progress, status, time_range } = req.body;

  if (progress === undefined || !status || !time_range) {
    return res.status(400).json({
      status: false,
      message: "progress, status, and time_range are required",
    });
  }

  const pct = Number(progress);
  if (Number.isNaN(pct) || pct < 0 || pct > 100) {
    return res.status(400).json({
      status: false,
      message: "progress must be between 0 and 100",
    });
  }

  const query = `
    UPDATE marketing_task_emp
    SET progress = ?, status = ?, updated_at = NOW()
    WHERE task_id = ? AND time_range = ?
  `;

  db.pool.query(query, [pct, status, taskId, time_range], (err, result) => {
    if (err) {
      console.error("Update task error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        status: false,
        message: "Task not found or no changes made",
      });
    }

    res.json({
      status: true,
      message: "Task updated successfully",
    });
  });
});

router.delete("/:id/history/:historyId", (req, res) => {
  console.log("DELETE /api/marketing/report-tasks/:id/history/:historyId called");
  const { historyId } = req.params;

  const query = "DELETE FROM marketing_history_report WHERE id = ?";

  db.pool.query(query, [historyId], (err, result) => {
    if (err) {
      console.error("Delete history error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        status: false,
        message: "History record not found",
      });
    }

    res.json({
      status: true,
      message: "History record deleted successfully",
    });
  });
});

module.exports = router;
