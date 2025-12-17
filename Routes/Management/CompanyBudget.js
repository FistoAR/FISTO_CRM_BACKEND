const express = require("express");
const router = express.Router();
const db = require("../../dataBase/connection");

// GET - Fetch all employees for dropdown/autocomplete
router.get("/employees", (req, res) => {
  console.log("GET /api/company-budget/employees called");

  const sql = `
    SELECT 
      employee_id AS employeeId,
      employee_name AS employeeName
    FROM employees_details
    WHERE working_status = 'Active'
    ORDER BY employee_name ASC
  `;

  db.pool.query(sql, (err, employees) => {
    if (err) {
      console.error("Error fetching employees:", err);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch employees",
      });
    }

    res.status(200).json({
      success: true,
      message: "Employees fetched successfully",
      employees: employees,
    });
  });
});

// GET - Fetch all budget entries with filters
router.get("/entries", (req, res) => {
  console.log("GET /api/company-budget/entries called");

  const { fromDate, toDate, paymentMethod } = req.query;

  let sql = `
    SELECT 
      cb.id,
      cb.date,
      cb.payment_method AS paymentMethod,
      cb.credited_amount AS creditedAmount,
      cb.debited_amount AS debitedAmount,
      cb.given_member AS givenMember,
      cb.received_member AS receivedMember,
      cb.reason,
      cb.updated_by AS updatedBy,
      cb.created_at AS createdAt,
      cb.updated_at AS updatedAt,
      gm.employee_name AS givenMemberName,
      rm.employee_name AS receivedMemberName,
      ub.employee_name AS updatedByName
    FROM company_budget cb
    LEFT JOIN employees_details gm ON cb.given_member = gm.employee_id
    LEFT JOIN employees_details rm ON cb.received_member = rm.employee_id
    LEFT JOIN employees_details ub ON cb.updated_by = ub.employee_id
    WHERE 1=1
  `;

  const params = [];

  // Date range filter
  if (fromDate && toDate) {
    sql += ` AND cb.date BETWEEN ? AND ?`;
    params.push(fromDate, toDate);
  } else if (fromDate) {
    sql += ` AND cb.date = ?`;
    params.push(fromDate);
  } else if (toDate) {
    sql += ` AND cb.date <= ?`;
    params.push(toDate);
  }

  // Payment method filter
  if (paymentMethod && paymentMethod !== "All") {
    sql += ` AND cb.payment_method = ?`;
    params.push(paymentMethod);
  }

  sql += ` ORDER BY cb.date DESC, cb.created_at DESC`;

  db.pool.query(sql, params, (err, entries) => {
    if (err) {
      console.error("Error fetching budget entries:", err);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch budget entries",
      });
    }

    res.status(200).json({
      success: true,
      message: "Budget entries fetched successfully",
      entries: entries,
    });
  });
});

// POST - Create new budget entry
router.post("/entries", (req, res) => {
  console.log("POST /api/company-budget/entries called");
  console.log("Request body:", req.body);

  const {
    date,
    paymentMethod,
    creditedAmount,
    debitedAmount,
    givenMember,
    receivedMember,
    reason,
    updatedBy,
  } = req.body;

  // Validation
  if (!date) {
    return res.status(400).json({
      success: false,
      error: "Date is required",
    });
  }

  if (!paymentMethod) {
    return res.status(400).json({
      success: false,
      error: "Payment method is required",
    });
  }

  if (!updatedBy) {
    return res.status(400).json({
      success: false,
      error: "Updated by information is required",
    });
  }

  // At least one amount should be provided
  const credited = parseFloat(creditedAmount) || 0;
  const debited = parseFloat(debitedAmount) || 0;

  if (credited === 0 && debited === 0) {
    return res.status(400).json({
      success: false,
      error: "Either credited or debited amount must be provided",
    });
  }

  const sql = `
    INSERT INTO company_budget 
    (date, payment_method, credited_amount, debited_amount, given_member, received_member, reason, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.pool.query(
    sql,
    [
      date,
      paymentMethod,
      credited,
      debited,
      givenMember || null,
      receivedMember || null,
      reason || null,
      updatedBy,
    ],
    (err, result) => {
      if (err) {
        console.error("Error creating budget entry:", err);
        return res.status(500).json({
          success: false,
          error: "Failed to create budget entry",
        });
      }

      // Fetch the newly created entry with employee names
      const fetchQuery = `
        SELECT 
          cb.id,
          cb.date,
          cb.payment_method AS paymentMethod,
          cb.credited_amount AS creditedAmount,
          cb.debited_amount AS debitedAmount,
          cb.given_member AS givenMember,
          cb.received_member AS receivedMember,
          cb.reason,
          cb.updated_by AS updatedBy,
          cb.created_at AS createdAt,
          cb.updated_at AS updatedAt,
          gm.employee_name AS givenMemberName,
          rm.employee_name AS receivedMemberName,
          ub.employee_name AS updatedByName
        FROM company_budget cb
        LEFT JOIN employees_details gm ON cb.given_member = gm.employee_id
        LEFT JOIN employees_details rm ON cb.received_member = rm.employee_id
        LEFT JOIN employees_details ub ON cb.updated_by = ub.employee_id
        WHERE cb.id = ?
      `;

      db.pool.query(fetchQuery, [result.insertId], (fetchErr, entries) => {
        if (fetchErr) {
          console.error("Error fetching new entry:", fetchErr);
          return res.status(500).json({
            success: false,
            error: "Entry created but failed to fetch details",
          });
        }

        res.status(201).json({
          success: true,
          message: "Budget entry created successfully",
          entry: entries[0],
        });
      });
    }
  );
});

// PUT - Update existing budget entry
router.put("/entries/:id", (req, res) => {
  const { id } = req.params;
  console.log(`PUT /api/company-budget/entries/${id} called`);
  console.log("Request body:", req.body);

  const {
    date,
    paymentMethod,
    creditedAmount,
    debitedAmount,
    givenMember,
    receivedMember,
    reason,
    updatedBy,
  } = req.body;

  // Validation
  if (!date || !paymentMethod || !updatedBy) {
    return res.status(400).json({
      success: false,
      error: "Date, payment method, and updated by are required",
    });
  }

  const credited = parseFloat(creditedAmount) || 0;
  const debited = parseFloat(debitedAmount) || 0;

  if (credited === 0 && debited === 0) {
    return res.status(400).json({
      success: false,
      error: "Either credited or debited amount must be provided",
    });
  }

  const sql = `
    UPDATE company_budget 
    SET 
      date = ?,
      payment_method = ?,
      credited_amount = ?,
      debited_amount = ?,
      given_member = ?,
      received_member = ?,
      reason = ?,
      updated_by = ?
    WHERE id = ?
  `;

  db.pool.query(
    sql,
    [
      date,
      paymentMethod,
      credited,
      debited,
      givenMember || null,
      receivedMember || null,
      reason || null,
      updatedBy,
      id,
    ],
    (err, result) => {
      if (err) {
        console.error("Error updating budget entry:", err);
        return res.status(500).json({
          success: false,
          error: "Failed to update budget entry",
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          error: "Budget entry not found",
        });
      }

      // Fetch updated entry
      const fetchQuery = `
        SELECT 
          cb.id,
          cb.date,
          cb.payment_method AS paymentMethod,
          cb.credited_amount AS creditedAmount,
          cb.debited_amount AS debitedAmount,
          cb.given_member AS givenMember,
          cb.received_member AS receivedMember,
          cb.reason,
          cb.updated_by AS updatedBy,
          cb.created_at AS createdAt,
          cb.updated_at AS updatedAt,
          gm.employee_name AS givenMemberName,
          rm.employee_name AS receivedMemberName,
          ub.employee_name AS updatedByName
        FROM company_budget cb
        LEFT JOIN employees_details gm ON cb.given_member = gm.employee_id
        LEFT JOIN employees_details rm ON cb.received_member = rm.employee_id
        LEFT JOIN employees_details ub ON cb.updated_by = ub.employee_id
        WHERE cb.id = ?
      `;

      db.pool.query(fetchQuery, [id], (fetchErr, entries) => {
        if (fetchErr) {
          console.error("Error fetching updated entry:", fetchErr);
          return res.status(500).json({
            success: false,
            error: "Entry updated but failed to fetch details",
          });
        }

        res.status(200).json({
          success: true,
          message: "Budget entry updated successfully",
          entry: entries[0],
        });
      });
    }
  );
});

// DELETE - Remove budget entry
router.delete("/entries/:id", (req, res) => {
  const { id } = req.params;
  console.log(`DELETE /api/company-budget/entries/${id} called`);

  const sql = `DELETE FROM company_budget WHERE id = ?`;

  db.pool.query(sql, [id], (err, result) => {
    if (err) {
      console.error("Error deleting budget entry:", err);
      return res.status(500).json({
        success: false,
        error: "Failed to delete budget entry",
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: "Budget entry not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Budget entry deleted successfully",
    });
  });
});

// GET - Dashboard statistics (optional)
router.get("/stats", (req, res) => {
  console.log("GET /api/company-budget/stats called");

  const { fromDate, toDate } = req.query;

  let sql = `
    SELECT 
      SUM(credited_amount) AS totalCredited,
      SUM(debited_amount) AS totalDebited,
      COUNT(*) AS totalEntries,
      SUM(credited_amount) - SUM(debited_amount) AS balance
    FROM company_budget
    WHERE 1=1
  `;

  const params = [];

  if (fromDate && toDate) {
    sql += ` AND date BETWEEN ? AND ?`;
    params.push(fromDate, toDate);
  } else if (fromDate) {
    sql += ` AND date = ?`;
    params.push(fromDate);
  } else if (toDate) {
    sql += ` AND date <= ?`;
    params.push(toDate);
  }

  db.pool.query(sql, params, (err, stats) => {
    if (err) {
      console.error("Error fetching stats:", err);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch statistics",
      });
    }

    res.status(200).json({
      success: true,
      message: "Statistics fetched successfully",
      stats: stats[0],
    });
  });
});

module.exports = router;
