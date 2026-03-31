const express = require("express");
const router = express.Router();
const { getConnectionWithRetry } = require("../../dataBase/connection");

// Helper function to format date without time
const formatDate = (date) => {
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

// Helper function to get employee name by ID
const getEmployeeName = async (connection, employeeId) => {
  if (!employeeId) return "Unknown";
  
  try {
    const [rows] = await new Promise((resolve, reject) => {
      connection.query(
        "SELECT employee_name FROM employees_details WHERE employee_id = ?",
        [employeeId],
        (err, results) => {
          if (err) reject(err);
          else resolve([results]);
        }
      );
    });

    return rows.length > 0 ? rows[0].employee_name : employeeId;
  } catch (error) {
    console.error("Error fetching employee name:", error);
    return employeeId;
  }
};

// GET - Fetch all marketing resources
router.get("/", async (req, res) => {
  let connection;
  try {
    const { employee_id, category } = req.query;

    connection = await getConnectionWithRetry();

    let query = "SELECT * FROM marketing_resources WHERE 1=1";
    const params = [];

    if (employee_id) {
      query += " AND employee_id = ?";
      params.push(employee_id);
    }

    if (category) {
      query += " AND category = ?";
      params.push(category);
    }

    query += " ORDER BY created_at DESC";

    const [rows] = await new Promise((resolve, reject) => {
      connection.query(query, params, (err, results) => {
        if (err) reject(err);
        else resolve([results]);
      });
    });

    // Get unique employee IDs from the results
    const employeeIds = [...new Set([
      ...rows.map(r => r.employee_id),
      ...rows.map(r => r.last_updated_by)
    ])].filter(Boolean);

    // Fetch all employee names in a single query for better performance
    const employeeNamesMap = {};
    if (employeeIds.length > 0) {
      const placeholders = employeeIds.map(() => '?').join(',');
      const [empRows] = await new Promise((resolve, reject) => {
        connection.query(
          `SELECT employee_id, employee_name FROM employees_details WHERE employee_id IN (${placeholders})`,
          employeeIds,
          (err, results) => {
            if (err) reject(err);
            else resolve([results]);
          }
        );
      });

      empRows.forEach(emp => {
        employeeNamesMap[emp.employee_id] = emp.employee_name;
      });
    }

    // Format dates and add employee names
    const formattedRows = rows.map((row) => ({
      ...row,
      date: formatDate(row.created_at),
      employee_name: employeeNamesMap[row.employee_id] || row.employee_id,
      last_updated_by_name: employeeNamesMap[row.last_updated_by] || row.last_updated_by
    }));

    res.json({
      status: true,
      message: "Resources fetched successfully",
      data: formattedRows,
    });
  } catch (error) {
    console.error("Error fetching resources:", error);
    res.status(500).json({
      status: false,
      message: "Failed to fetch resources",
      error: error.message,
    });
  } finally {
    if (connection) connection.release();
  }
});

// POST - Create new resource
router.post("/", async (req, res) => {
  let connection;
  try {
    const {
      resource_category,
      link_name,
      link_description,
      link,
      category,
      employee_id
    } = req.body;

    // Validation
    if (!resource_category || !link_name || !link || !category || !employee_id) {
      return res.status(400).json({
        status: false,
        message: "Missing required fields: resource_category, link_name, link, category, employee_id",
      });
    }

    if (!["SEO", "SMM", "CM", "Others"].includes(resource_category)) {
      return res.status(400).json({
        status: false,
        message: 'Resource category must be one of: SEO, SMM, CM, Others',
      });
    }

    if (!["important", "rough"].includes(category)) {
      return res.status(400).json({
        status: false,
        message: 'Category must be either "important" or "rough"',
      });
    }

    connection = await getConnectionWithRetry();

    const query = `
      INSERT INTO marketing_resources 
      (resource_category, link_name, link_description, link, category, employee_id, last_updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const result = await new Promise((resolve, reject) => {
      connection.query(
        query,
        [
          resource_category,
          link_name,
          link_description || null,
          link,
          category,
          employee_id,
          employee_id, // Set last_updated_by to creator initially
        ],
        (err, results) => {
          if (err) reject(err);
          else resolve(results);
        }
      );
    });

    // Fetch the created resource
    const [rows] = await new Promise((resolve, reject) => {
      connection.query(
        "SELECT * FROM marketing_resources WHERE id = ?",
        [result.insertId],
        (err, results) => {
          if (err) reject(err);
          else resolve([results]);
        }
      );
    });

    const row = rows[0];
    const employeeName = await getEmployeeName(connection, row.employee_id);
    const lastUpdatedByName = await getEmployeeName(connection, row.last_updated_by);

    const resource = {
      ...row,
      date: formatDate(row.created_at),
      employee_name: employeeName,
      last_updated_by_name: lastUpdatedByName
    };

    res.status(201).json({
      status: true,
      message: "Resource created successfully",
      data: resource,
    });
  } catch (error) {
    console.error("Error creating resource:", error);
    res.status(500).json({
      status: false,
      message: "Failed to create resource",
      error: error.message,
    });
  } finally {
    if (connection) connection.release();
  }
});

// PUT - Update resource
router.put("/:id", async (req, res) => {
  let connection;
  try {
    const { id } = req.params;
    const { resource_category, link_name, link_description, link, category, employee_id } = req.body;

    connection = await getConnectionWithRetry();

    // Check if resource exists
    const [existing] = await new Promise((resolve, reject) => {
      connection.query(
        "SELECT * FROM marketing_resources WHERE id = ?",
        [id],
        (err, results) => {
          if (err) reject(err);
          else resolve([results]);
        }
      );
    });

    if (existing.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Resource not found",
      });
    }

    // Validation
    if (!link_name || !link) {
      return res.status(400).json({
        status: false,
        message: "Missing required fields: link_name, link",
      });
    }

    if (resource_category && !["SEO", "SMM", "CM", "Others"].includes(resource_category)) {
      return res.status(400).json({
        status: false,
        message: 'Resource category must be one of: SEO, SMM, CM, Others',
      });
    }

    if (category && !["important", "rough"].includes(category)) {
      return res.status(400).json({
        status: false,
        message: 'Category must be either "important" or "rough"',
      });
    }

    const query = `
      UPDATE marketing_resources 
      SET resource_category = COALESCE(?, resource_category),
          link_name = ?, 
          link_description = ?, 
          link = ?,
          category = COALESCE(?, category),
          last_updated_by = ?
      WHERE id = ?
    `;

    await new Promise((resolve, reject) => {
      connection.query(
        query,
        [
          resource_category || null,
          link_name,
          link_description || null,
          link,
          category || null,
          employee_id, // Update last_updated_by with employee_id
          id,
        ],
        (err, results) => {
          if (err) reject(err);
          else resolve(results);
        }
      );
    });

    // Fetch updated resource
    const [rows] = await new Promise((resolve, reject) => {
      connection.query(
        "SELECT * FROM marketing_resources WHERE id = ?",
        [id],
        (err, results) => {
          if (err) reject(err);
          else resolve([results]);
        }
      );
    });

    const row = rows[0];
    const employeeName = await getEmployeeName(connection, row.employee_id);
    const lastUpdatedByName = await getEmployeeName(connection, row.last_updated_by);

    const resource = {
      ...row,
      date: formatDate(row.created_at),
      employee_name: employeeName,
      last_updated_by_name: lastUpdatedByName
    };

    res.json({
      status: true,
      message: "Resource updated successfully",
      data: resource,
    });
  } catch (error) {
    console.error("Error updating resource:", error);
    res.status(500).json({
      status: false,
      message: "Failed to update resource",
      error: error.message,
    });
  } finally {
    if (connection) connection.release();
  }
});

// DELETE - Delete resource
router.delete("/:id", async (req, res) => {
  let connection;
  try {
    const { id } = req.params;

    connection = await getConnectionWithRetry();

    // Check if resource exists
    const [existing] = await new Promise((resolve, reject) => {
      connection.query(
        "SELECT * FROM marketing_resources WHERE id = ?",
        [id],
        (err, results) => {
          if (err) reject(err);
          else resolve([results]);
        }
      );
    });

    if (existing.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Resource not found",
      });
    }

    await new Promise((resolve, reject) => {
      connection.query(
        "DELETE FROM marketing_resources WHERE id = ?",
        [id],
        (err, results) => {
          if (err) reject(err);
          else resolve(results);
        }
      );
    });

    res.json({
      status: true,
      message: "Resource deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting resource:", error);
    res.status(500).json({
      status: false,
      message: "Failed to delete resource",
      error: error.message,
    });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
