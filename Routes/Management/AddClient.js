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

function generateContactPersonId() {
  return Math.floor(Math.random() * (9999 - 100 + 1)) + 100;
}

// function generateUniqueContactPersonId(existingContactPersons = []) {
//   const existingIds = new Set(
//     existingContactPersons.map(person => person.id).filter(id => id != null)
//   );
  
//   let newId;
//   let attempts = 0;
//   const maxAttempts = 100;
  
//   do {
//     newId = generateContactPersonId();
//     attempts++;
    
//     if (attempts > maxAttempts) {
//       throw new Error("Unable to generate unique contact person ID");
//     }
//   } while (existingIds.has(newId));
  
//   return newId;
// }

function ensureContactPersonIds(contactPersons) {
  if (!Array.isArray(contactPersons)) {
    return [];
  }
  
  const existingIds = new Set();
  
  return contactPersons.map(person => {
    if (person.id && !existingIds.has(person.id)) {
      existingIds.add(person.id);
      return person;
    }
    
    let newId;
    do {
      newId = generateContactPersonId();
    } while (existingIds.has(newId));
    
    existingIds.add(newId);
    
    return {
      ...person,
      id: newId
    };
  });
}

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

    const validContacts = contactPersons?.filter(cp => cp.name?.trim()) || [];
    
    let contactPersonsWithIds;
    
    if (clientData.id) {
      const existingClient = await queryWithRetry(
        "SELECT contactPersons FROM ClientsDataManagement WHERE id = ?",
        [clientData.id]
      );
      
      let existingContacts = [];
      if (existingClient.length > 0 && existingClient[0].contactPersons) {
        try {
          existingContacts = typeof existingClient[0].contactPersons === 'string'
            ? JSON.parse(existingClient[0].contactPersons)
            : existingClient[0].contactPersons;
        } catch (err) {
          console.error("Error parsing existing contacts:", err);
        }
      }
      
      const allExistingIds = new Set(existingContacts.map(c => c.id).filter(id => id != null));
      
      contactPersonsWithIds = validContacts.map(contact => {
        if (contact.id && allExistingIds.has(contact.id)) {
          return { ...contact, id: contact.id };
        }
        
        let newId;
        do {
          newId = generateContactPersonId();
        } while (allExistingIds.has(newId));
        
        allExistingIds.add(newId);
        
        return {
          ...contact,
          id: newId
        };
      });
    } else {
      contactPersonsWithIds = ensureContactPersonIds(validContacts);
    }
    
    const contactPersonsJSON = JSON.stringify(contactPersonsWithIds);

    if (clientData.id) {
      await new Promise((resolve, reject) => {
        connection.query(
          `UPDATE ClientsDataManagement 
           SET  company_name=?, customer_name=?, 
               industry_type=?, website=?, contactPersons=?, address=?, 
               city=?, state=?, reference=?, requirements=?, 
               updated_at=CURRENT_TIMESTAMP
           WHERE id=?`,
          [
            clientData.company_name,
            clientData.customer_name,
            clientData.industry_type || null,
            clientData.website || null,
            contactPersonsJSON,
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

      await new Promise((resolve, reject) => {
        connection.commit((err) => (err ? reject(err) : resolve()));
      });

      res.status(200).json({
        success: true,
        message: "Client updated",
        clientId: clientData.id,
        contactPersons: contactPersonsWithIds,
      });
    } else {
      const result = await new Promise((resolve, reject) => {
        connection.query(
          `INSERT INTO ClientsDataManagement 
           (employee_id, company_name, customer_name, industry_type, 
            website, contactPersons, address, city, state, reference, 
            requirements, active)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
          [
            clientData.employee_id,
            clientData.company_name,
            clientData.customer_name,
            clientData.industry_type || null,
            clientData.website || null,
            contactPersonsJSON,
            clientData.address || null,
            clientData.city || null,
            clientData.state || null,
            clientData.reference || null,
            clientData.requirements || null,
          ],
          (err, result) => (err ? reject(err) : resolve(result))
        );
      });

      await new Promise((resolve, reject) => {
        connection.commit((err) => (err ? reject(err) : resolve()));
      });

      res.status(200).json({
        success: true,
        message: "Client added",
        clientId: result.insertId,
        contactPersons: contactPersonsWithIds,
      });
    }
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
      SELECT * FROM ClientsDataManagement
      WHERE active = ?
    `;

    const params = [activeValue];

    if (employee_id) {
      query += " AND employee_id = ?";
      params.push(employee_id);
    }

    query += " ORDER BY created_at DESC";

    const results = await queryWithRetry(query, params);

    if (results.length > 0) {
      const clients = results.map((client) => {
        let contactPersons = [];
        
        try {
          contactPersons = typeof client.contactPersons === 'string' 
            ? JSON.parse(client.contactPersons) 
            : (client.contactPersons || []);
          
          contactPersons = ensureContactPersonIds(contactPersons);
        } catch (err) {
          console.error("Error parsing contactPersons:", err);
          contactPersons = [];
        }

        return {
          ...client,
          contactPersons,
        };
      });

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
      "SELECT * FROM ClientsDataManagement WHERE id=? AND active=1",
      [id]
    );

    if (!clientResults.length) {
      return res.status(404).json({ error: "Client not found" });
    }

    const client = clientResults[0];
    
    let contactPersons = [];
    try {
      contactPersons = typeof client.contactPersons === 'string'
        ? JSON.parse(client.contactPersons)
        : (client.contactPersons || []);
      
      contactPersons = ensureContactPersonIds(contactPersons);
    } catch (err) {
      console.error("Error parsing contactPersons:", err);
      contactPersons = [];
    }
    
    client.contactPersons = contactPersons;

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
      "UPDATE ClientsDataManagement SET active=0 WHERE id=?",
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
      "UPDATE ClientsDataManagement SET active = 1 WHERE id = ?",
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
      fs.unlinkSync(req.file.path);
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
    res.status(500).json({ message: "Upload failed", error: error.message });
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
      const contactPersons = [];
      
      const contactName = row["Contact Person"] || row["contact_person"] || "";
      const phoneNumberString = String(row["Phone Number"] || row["phone_number"] || "").trim();
      const contactEmail = row["Mail ID"] || row["email"] || "";
      const contactDesignation = row["Designation"] || row["designation"] || "";

      // Check if phone numbers are comma-separated
      if (phoneNumberString && phoneNumberString.includes(",")) {
        const phoneNumbers = phoneNumberString
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p);
        
        const baseContactName = contactName || "Contact Person";

        // Create separate contact person entries for each phone number
        for (let i = 0; i < phoneNumbers.length; i++) {
          contactPersons.push({
            name: `${baseContactName} ${i + 1}`,
            contactNumber: phoneNumbers[i],
            email: contactEmail,
            designation: contactDesignation,
          });
        }
      } else {
        // Single contact person
        if (contactName.trim() || phoneNumberString.trim()) {
          contactPersons.push({
            name: contactName,
            contactNumber: phoneNumberString,
            email: contactEmail,
            designation: contactDesignation,
          });
        }
      }

      const contactPersonsWithIds = ensureContactPersonIds(contactPersons);
      const contactPersonsJSON = JSON.stringify(contactPersonsWithIds);

      await queryWithRetry(
        `INSERT INTO ClientsDataManagement 
         (employee_id, company_name, customer_name, industry_type, 
          website, contactPersons, address, city, state, reference, requirements)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          employee_id,
          row["Company name"] || row["company_name"] || "",
          row["Customer Name"] || row["customer_name"] || "",
          row["Industry Type"] || row["industry_type"] || "",
          row["Website"] || row["website"] || "",
          contactPersonsJSON,
          row["Address"] || row["address"] || "",
          row["City"] || row["city"] || "",
          row["State"] || row["state"] || "",
          row["Reference"] || row["reference"] || "",
          row["Requirements"] || row["requirements"] || "",
        ]
      );

      results.inserted++;
    } catch (error) {
      console.error("Insert error:", error);
      results.failed++;
      results.errors.push({ row, error: error.message });
    }
  }

  return results;
}

module.exports = router;