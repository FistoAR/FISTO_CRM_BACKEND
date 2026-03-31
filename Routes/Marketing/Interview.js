const express = require("express");
const router = express.Router();
const db = require("../../dataBase/connection");

// GET all interviews
router.get("/", (req, res) => {
  console.log("GET /api/interviews called");

  const query = `
    SELECT 
      id,
      name,
      phone_number as phoneNumber,
      city,
      position,
      schedule_date as scheduleDate,
      status,
      remarks,
      created_at as createdAt,
      updated_at as updatedAt
    FROM interviews
    ORDER BY schedule_date DESC, created_at DESC
  `;

  db.pool.query(query, (err, results) => {
    if (err) {
      console.error("Fetch interviews error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.json({
      status: true,
      interviews: results,
      count: results.length
    });
  });
});

// GET single interview by ID
router.get("/:id", (req, res) => {
  const { id } = req.params;
  console.log("GET /api/interviews/:id called for ID:", id);

  const query = `
    SELECT 
      id,
      name,
      phone_number as phoneNumber,
      city,
      position,
      schedule_date as scheduleDate,
      status,
      remarks,
      created_at as createdAt,
      updated_at as updatedAt
    FROM interviews
    WHERE id = ?
  `;

  db.pool.query(query, [id], (err, results) => {
    if (err) {
      console.error("Fetch single interview error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Interview not found",
      });
    }

    res.json({
      status: true,
      interview: results[0],
    });
  });
});

// POST - Create new interview
router.post("/", (req, res) => {
  console.log("POST /api/interviews called");
  const { name, phoneNumber, city, position, scheduleDate, status, remarks } = req.body;

  // Validation
  if (!name || !phoneNumber || !city || !position || !scheduleDate) {
    return res.status(400).json({
      status: false,
      message: "Required fields: name, phoneNumber, city, position, scheduleDate",
    });
  }

  // Validate status if provided
  const validStatuses = ['Pending', 'Attended', 'Re-schedule', 'Cancelled'];
  const interviewStatus = status || 'Pending';
  
  if (!validStatuses.includes(interviewStatus)) {
    return res.status(400).json({
      status: false,
      message: "Invalid status. Must be one of: Pending, Attended, Re-schedule, Cancelled",
    });
  }

  const query = `
    INSERT INTO interviews 
    (name, phone_number, city, position, schedule_date, status, remarks)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  db.pool.query(
    query,
    [
      name,
      phoneNumber,
      city,
      position,
      scheduleDate,
      interviewStatus,
      remarks || null
    ],
    (err, result) => {
      if (err) {
        console.error("Insert interview error:", err);
        return res.status(500).json({
          status: false,
          message: "Database error",
          error: err.message,
        });
      }

      console.log("Interview created successfully, ID:", result.insertId);
      res.status(201).json({
        status: true,
        message: "Interview scheduled successfully",
        id: result.insertId,
      });
    }
  );
});

// PUT - Update interview
router.put("/:id", (req, res) => {
  const { id } = req.params;
  console.log("PUT /api/interviews/:id called for ID:", id);
  const { name, phoneNumber, city, position, scheduleDate, status, remarks } = req.body;

  // Validation
  if (!name || !phoneNumber || !city || !position || !scheduleDate) {
    return res.status(400).json({
      status: false,
      message: "Required fields: name, phoneNumber, city, position, scheduleDate",
    });
  }

  // Validate status if provided
  const validStatuses = ['Pending', 'Attended', 'Re-schedule', 'Cancelled'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({
      status: false,
      message: "Invalid status. Must be one of: Pending, Attended, Re-schedule, Cancelled",
    });
  }

  const query = `
    UPDATE interviews 
    SET 
      name = ?,
      phone_number = ?,
      city = ?,
      position = ?,
      schedule_date = ?,
      status = ?,
      remarks = ?
    WHERE id = ?
  `;

  db.pool.query(
    query,
    [
      name,
      phoneNumber,
      city,
      position,
      scheduleDate,
      status || 'Pending',
      remarks || null,
      id
    ],
    (err, result) => {
      if (err) {
        console.error("Update interview error:", err);
        return res.status(500).json({
          status: false,
          message: "Database error",
          error: err.message,
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({
          status: false,
          message: "Interview not found",
        });
      }

      console.log("Interview updated successfully, ID:", id);
      res.json({
        status: true,
        message: "Interview updated successfully",
        id: id,
      });
    }
  );
});

// PATCH - Update only status and remarks (for status update modal)
router.patch("/:id/status", (req, res) => {
  const { id } = req.params;
  console.log("PATCH /api/interviews/:id/status called for ID:", id);
  const { status, remarks, newScheduleDate } = req.body;

  // Validation
  if (!status) {
    return res.status(400).json({
      status: false,
      message: "Status is required",
    });
  }

  const validStatuses = ['Pending', 'Attended', 'Re-schedule', 'Cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      status: false,
      message: "Invalid status. Must be one of: Pending, Attended, Re-schedule, Cancelled",
    });
  }

  // If status is Re-schedule, newScheduleDate is required
  if (status === 'Re-schedule' && !newScheduleDate) {
    return res.status(400).json({
      status: false,
      message: "New schedule date is required for Re-schedule status",
    });
  }

  // Build dynamic query based on whether we need to update schedule_date
  let query;
  let params;

  if (status === 'Re-schedule' && newScheduleDate) {
    query = `
      UPDATE interviews 
      SET 
        status = ?,
        remarks = ?,
        schedule_date = ?
      WHERE id = ?
    `;
    params = [status, remarks || null, newScheduleDate, id];
  } else {
    query = `
      UPDATE interviews 
      SET 
        status = ?,
        remarks = ?
      WHERE id = ?
    `;
    params = [status, remarks || null, id];
  }

  db.pool.query(query, params, (err, result) => {
    if (err) {
      console.error("Update interview status error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        status: false,
        message: "Interview not found",
      });
    }

    console.log("Interview status updated successfully, ID:", id);
    res.json({
      status: true,
      message: `Interview status updated to ${status}`,
      id: id,
    });
  });
});

// DELETE - Delete interview
router.delete("/:id", (req, res) => {
  const { id } = req.params;
  console.log("DELETE /api/interviews/:id called for ID:", id);

  const query = "DELETE FROM interviews WHERE id = ?";

  db.pool.query(query, [id], (err, result) => {
    if (err) {
      console.error("Delete interview error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        status: false,
        message: "Interview not found",
      });
    }

    console.log("Interview deleted successfully, ID:", id);
    res.json({
      status: true,
      message: "Interview deleted successfully",
    });
  });
});

// GET - Filter interviews by status
router.get("/filter/status/:status", (req, res) => {
  const { status } = req.params;
  console.log("GET /api/interviews/filter/status/:status called for status:", status);

  const validStatuses = ['Pending', 'Attended', 'Re-schedule', 'Cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      status: false,
      message: "Invalid status. Must be one of: Pending, Attended, Re-schedule, Cancelled",
    });
  }

  const query = `
    SELECT 
      id,
      name,
      phone_number as phoneNumber,
      city,
      position,
      schedule_date as scheduleDate,
      status,
      remarks,
      created_at as createdAt,
      updated_at as updatedAt
    FROM interviews
    WHERE status = ?
    ORDER BY schedule_date DESC, created_at DESC
  `;

  db.pool.query(query, [status], (err, results) => {
    if (err) {
      console.error("Filter interviews by status error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.json({
      status: true,
      interviews: results,
      count: results.length,
      filterStatus: status
    });
  });
});

// GET - Get upcoming interviews (schedule_date >= today)
router.get("/filter/upcoming", (req, res) => {
  console.log("GET /api/interviews/filter/upcoming called");

  const query = `
    SELECT 
      id,
      name,
      phone_number as phoneNumber,
      city,
      position,
      schedule_date as scheduleDate,
      status,
      remarks,
      created_at as createdAt,
      updated_at as updatedAt
    FROM interviews
    WHERE schedule_date >= CURDATE()
    ORDER BY schedule_date ASC, created_at DESC
  `;

  db.pool.query(query, (err, results) => {
    if (err) {
      console.error("Fetch upcoming interviews error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.json({
      status: true,
      interviews: results,
      count: results.length
    });
  });
});

// GET - Get past interviews (schedule_date < today)
router.get("/filter/past", (req, res) => {
  console.log("GET /api/interviews/filter/past called");

  const query = `
    SELECT 
      id,
      name,
      phone_number as phoneNumber,
      city,
      position,
      schedule_date as scheduleDate,
      status,
      remarks,
      created_at as createdAt,
      updated_at as updatedAt
    FROM interviews
    WHERE schedule_date < CURDATE()
    ORDER BY schedule_date DESC, created_at DESC
  `;

  db.pool.query(query, (err, results) => {
    if (err) {
      console.error("Fetch past interviews error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.json({
      status: true,
      interviews: results,
      count: results.length
    });
  });
});

// GET - Search interviews by name, phone, city, or position
router.get("/search/:term", (req, res) => {
  const { term } = req.params;
  console.log("GET /api/interviews/search/:term called with term:", term);

  const searchTerm = `%${term}%`;

  const query = `
    SELECT 
      id,
      name,
      phone_number as phoneNumber,
      city,
      position,
      schedule_date as scheduleDate,
      status,
      remarks,
      created_at as createdAt,
      updated_at as updatedAt
    FROM interviews
    WHERE 
      name LIKE ? OR
      phone_number LIKE ? OR
      city LIKE ? OR
      position LIKE ?
    ORDER BY schedule_date DESC, created_at DESC
  `;

  db.pool.query(
    query,
    [searchTerm, searchTerm, searchTerm, searchTerm],
    (err, results) => {
      if (err) {
        console.error("Search interviews error:", err);
        return res.status(500).json({
          status: false,
          message: "Database error",
          error: err.message,
        });
      }

      res.json({
        status: true,
        interviews: results,
        count: results.length,
        searchTerm: term
      });
    }
  );
});

// GET - Statistics/Dashboard data
router.get("/stats/summary", (req, res) => {
  console.log("GET /api/interviews/stats/summary called");

  const query = `
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'Attended' THEN 1 ELSE 0 END) as attended,
      SUM(CASE WHEN status = 'Re-schedule' THEN 1 ELSE 0 END) as rescheduled,
      SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) as cancelled,
      SUM(CASE WHEN schedule_date >= CURDATE() THEN 1 ELSE 0 END) as upcoming,
      SUM(CASE WHEN schedule_date < CURDATE() THEN 1 ELSE 0 END) as past
    FROM interviews
  `;

  db.pool.query(query, (err, results) => {
    if (err) {
      console.error("Fetch interview statistics error:", err);
      return res.status(500).json({
        status: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.json({
      status: true,
      stats: results[0]
    });
  });
});

module.exports = router;