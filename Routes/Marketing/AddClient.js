const express = require("express");
const router = express.Router();
const multer = require("multer");
const xlsx = require("xlsx");
const csv = require("csv-parser");
const fs = require("fs");
const {
  queryWithRetry,
  getConnectionWithRetry,
} = require("../../dataBase/connection");

const upload = multer({
  dest: "uploads/",
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type"));
    }
  },
});

router.post("/", async (req, res) => {
  const { clientData, contactPersons } = req.body;

  if (!clientData?.company_name || !clientData?.customer_name) {
    return res.status(400).json({
      error: "Company name and customer name required",
    });
  }

  let connection;

  try {
    connection = await getConnectionWithRetry();

    await new Promise((resolve, reject) => {
      connection.beginTransaction((err) => (err ? reject(err) : resolve()));
    });

    let clientId;

    if (clientData.id) {
      await new Promise((resolve, reject) => {
        connection.query(
          `UPDATE ClientsData 
           SET company_name=?, customer_name=?, 
               industry_type=?, website=?, address=?, city=?, state=?, 
               reference=?, requirements=?, updated_at=CURRENT_TIMESTAMP
           WHERE id=?`,
          [
            clientData.company_name,
            clientData.customer_name,
            clientData.industry_type || null,
            clientData.website || null,
            clientData.address || null,
            clientData.city || null,
            clientData.state || null,
            clientData.reference || null,
            clientData.requirements || null,
            clientData.id,
          ],
          (err) => (err ? reject(err) : resolve())
        );
      });

      clientId = clientData.id;

      await new Promise((resolve, reject) => {
        connection.query(
          "DELETE FROM ContactPersons WHERE clientID=?",
          [clientId],
          (err) => (err ? reject(err) : resolve())
        );
      });
    } else {
      const result = await new Promise((resolve, reject) => {
        connection.query(
          `INSERT INTO ClientsData 
           (employee_id, company_name, customer_name, industry_type, 
            website, address, city, state, reference, requirements, active)
           VALUES (?,?,?,?,?,?,?,?,?,?,1)`,
          [
            clientData.employee_id,
            clientData.company_name,
            clientData.customer_name,
            clientData.industry_type || null,
            clientData.website || null,
            clientData.address || null,
            clientData.city || null,
            clientData.state || null,
            clientData.reference || null,
            clientData.requirements || null,
          ],
          (err, result) => (err ? reject(err) : resolve(result))
        );
      });

      clientId = result.insertId;
    }

    if (contactPersons?.length) {
      for (const contact of contactPersons) {
        if (contact.name?.trim()) {
          await new Promise((resolve, reject) => {
            connection.query(
              `INSERT INTO ContactPersons (clientID, name, contactNumber, email, designation)
             VALUES (?,?,?,?,?)`,
              [
                clientId,
                contact.name,
                contact.contactNumber,
                contact.email || null,
                contact.designation || null,
              ],
              (err) => (err ? reject(err) : resolve())
            );
          });
        }
      }
    }

    await new Promise((resolve, reject) => {
      connection.commit((err) => (err ? reject(err) : resolve()));
    });

    res.status(200).json({
      success: true,
      message: clientData.id ? "Client updated" : "Client added",
      clientId,
    });
  } catch (error) {
    if (connection) {
      await new Promise((resolve) => {
        connection.rollback(() => resolve());
      });
    }
    console.error("Error saving client:", error);

    if (error.message.includes("busy")) {
      res.status(503).json({ error: "Server busy. Try again." });
    } else {
      res.status(500).json({ error: "Failed to save client" });
    }
  } finally {
    if (connection) connection.release();
  }
});

router.get("/", async (req, res) => {
  try {
    const { employee_id, active } = req.query;

    let activeValue = 1;

    if (active === "false") activeValue = 0;
    if (active === "true") activeValue = 1;

    let query = `
      SELECT c.*,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'id', cp.id, 'name', cp.name,
            'contactNumber', cp.contactNumber,
            'email', cp.email, 'designation', cp.designation
          )
        ) as contactPersons
      FROM ClientsData c
      LEFT JOIN ContactPersons cp ON c.id = cp.clientID
      WHERE c.active = ?
    `;

    const params = [activeValue];

    if (employee_id) {
      query += " AND c.employee_id = ?";
      params.push(employee_id);
    }

    query += " GROUP BY c.id ORDER BY c.created_at DESC";

    const results = await queryWithRetry(query, params);

    if (results.length > 0) {
      const clients = results.map((client) => ({
        ...client,
        contactPersons: JSON.parse(client.contactPersons).filter(
          (cp) => cp.id !== null
        ),
      }));

      res.status(200).json({ success: true, data: clients });
    } else {
      res.status(200).json({ success: false, data: [] });
    }
  } catch (err) {
    console.error("Error fetching clients:", err);

    if (err.message.includes("busy")) {
      res.status(503).json({ error: "Server busy. Try again." });
    } else {
      res.status(500).json({ error: "Failed to fetch clients" });
    }
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const clientResults = await queryWithRetry(
      "SELECT * FROM ClientsData WHERE id=? AND active=1",
      [id]
    );

    if (!clientResults.length) {
      return res.status(404).json({ error: "Client not found" });
    }

    const client = clientResults[0];
    const contactResults = await queryWithRetry(
      "SELECT * FROM ContactPersons WHERE clientID=?",
      [id]
    );

    client.contactPersons = contactResults;
    res.status(200).json({ success: true, data: client });
  } catch (err) {
    console.error("Error fetching client:", err);
    res.status(500).json({ error: "Failed to fetch client" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await queryWithRetry(
      "UPDATE ClientsData SET active=0 WHERE id=?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    res.status(200).json({ success: true, message: "Client deleted" });
  } catch (err) {
    console.error("Error deleting client:", err);
    res.status(500).json({ error: "Failed to delete client" });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await queryWithRetry(
      "UPDATE ClientsData SET active = 1 WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    res.status(200).json({ success: true, message: "Client restored" });
  } catch (err) {
    console.error("Error restoring client:", err);
    res.status(500).json({ error: "Failed to restore client" });
  }
});

router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const { employee_id } = req.body;

    if (!employee_id) {
      return res.status(400).json({ message: "Employee ID is required" });
    }

    const filePath = req.file.path;
    const ext = req.file.originalname.split(".").pop().toLowerCase();
    let clientsData = [];

    if (ext === "csv") {
      clientsData = await parseCSV(filePath);
    } else if (["xlsx", "xls"].includes(ext)) {
      clientsData = parseExcel(filePath);
    }

    const results = await insertClientsData(clientsData, employee_id);
    fs.unlinkSync(filePath);

    res.status(200).json({
      success: true,
      message: "Upload successful",
      inserted: results.inserted,
      failed: results.failed,
      total: clientsData.length,
    });
  } catch (error) {
    console.error("Upload error:", error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ 
      success: false,
      message: "Upload failed", 
      error: error.message 
    });
  }
});

function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (data) => results.push(data))
      .on("end", () => resolve(results))
      .on("error", reject);
  });
}

function parseExcel(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return xlsx.utils.sheet_to_json(sheet);
}

async function insertClientsData(clientsData, employee_id) {
  const results = { inserted: 0, failed: 0, errors: [] };

  for (const row of clientsData) {
    try {
      const clientResult = await queryWithRetry(
        `INSERT INTO ClientsData 
         (employee_id, company_name, customer_name, industry_type, 
          website, address, city, state, reference, requirements)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          employee_id,
          row["Company name"] || row["company_name"] || "",
          row["Customer Name"] || row["customer_name"] || "",
          row["Industry Type"] || row["industry_type"] || "",
          row["Website"] || row["website"] || "",
          row["Address"] || row["address"] || "",
          row["City"] || row["city"] || "",
          row["State"] || row["state"] || "",
          row["Reference"] || row["reference"] || "",
          row["Requirements"] || row["requirements"] || "",
        ]
      );

      const clientId = clientResult.insertId;

      const phoneNumberString = String(row["Phone Number"] || "").trim();

      if (phoneNumberString && phoneNumberString.includes(",")) {
        const phoneNumbers = phoneNumberString
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p);
        const baseContactName = row["Contact Person"] || "Contact Person";

        for (let i = 0; i < phoneNumbers.length; i++) {
          const contactName = `${baseContactName} ${i + 1}`;

          await queryWithRetry(
            `INSERT INTO ContactPersons (clientID, name, contactNumber, email, designation)
       VALUES (?,?,?,?,?)`,
            [
              clientId,
              contactName,
              phoneNumbers[i],
              row["Mail ID"] || "",
              row["Designation"] || "",
            ]
          );
        }
      } else {
        await queryWithRetry(
          `INSERT INTO ContactPersons (clientID, name, contactNumber, email, designation)
     VALUES (?,?,?,?,?)`,
          [
            clientId,
            row["Contact Person"] || "",
            phoneNumberString,
            row["Mail ID"] || "",
            row["Designation"] || "",
          ]
        );
      }

      results.inserted++;
    } catch (error) {
      console.error("Insert error:", error);
      results.failed++;
      results.errors.push({ row, error: error.message });
    }
  }

  return results;
}

// ============================================
// EMPLOYEE ROUTES - For Project Head Dropdown
// ============================================

// Fetch employees by designation (for Project Head dropdown)
router.post("/employees/by-designation", async (req, res) => {
  try {
    const { designations } = req.body;

    if (!designations || !Array.isArray(designations)) {
      return res.status(400).json({
        success: false,
        message: "Designations array is required",
      });
    }

    if (designations.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one designation is required",
      });
    }

    const placeholders = designations.map(() => "?").join(",");

    const query = `
      SELECT 
        employee_id, 
        employee_name, 
        designation,
        email_official,
        phone_official,
        employment_type
      FROM employees_details 
      WHERE designation IN (${placeholders})
      AND working_status = 'Active'
      ORDER BY employee_name ASC
    `;

    const employees = await queryWithRetry(query, designations);

    res.status(200).json({
      success: true,
      data: employees,
      count: employees.length,
    });
  } catch (error) {
    console.error("Error fetching employees by designation:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch employees",
      error: error.message,
    });
  }
});

module.exports = router;
