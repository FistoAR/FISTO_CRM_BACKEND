const express = require("express");
const router = express.Router();
const db = require("../../dataBase/connection");
const uploadFields = require("../../middleware/uploadMiddleware");
const fs = require("fs");
const path = require("path");

// GET all employees
router.get("/", (req, res) => {
  console.log("GET /api/employeeRegister called");

  const query = `
    SELECT 
      employee_id, intern_id, employee_name, dob, gender,
      email_personal, email_official, phone_personal, phone_official,
      phone_alternative, phone_relation, blood_group,
      account_name, account_number, bank_name, ifsc_code,
      designation, team_head, employment_type, working_status,
      join_date, intern_start_date, intern_end_date, duration_months,
      address, profile_url, resume_url, offer_letter_url,
      ID_url, Certificates_url, otherDocs_url, exit_docs_url
    FROM employees_details
    ORDER BY employee_id DESC
  `;

  db.pool.query(query, (err, results) => {
    if (err) {
      console.error("Fetch error:", err);
      return res.status(500).json({
        status: false,
        message: "DB error",
        error: err.message,
      });
    }

    // Parse JSON fields
    const employees = results.map((emp) => {
      let ID_url = {};
      let Certificates_url = {};
      let otherDocs_url = [];
      let exit_docs_url = {};

      try {
        ID_url = emp.ID_url ? JSON.parse(emp.ID_url) : {};
        Certificates_url = emp.Certificates_url
          ? JSON.parse(emp.Certificates_url)
          : {};
        otherDocs_url = emp.otherDocs_url ? JSON.parse(emp.otherDocs_url) : [];
        exit_docs_url = emp.exit_docs_url ? JSON.parse(emp.exit_docs_url) : {};
      } catch (parseErr) {
        console.error("JSON parse error:", parseErr);
      }

      return {
        employee_id: emp.employee_id,
        intern_id: emp.intern_id,
        employee_name: emp.employee_name,
        dob: emp.dob,
        gender: emp.gender,
        email_personal: emp.email_personal,
        email_official: emp.email_official,
        phone_personal: emp.phone_personal,
        phone_official: emp.phone_official,
        phone_alternative: emp.phone_alternative,
        phone_relation: emp.phone_relation,
        blood_group: emp.blood_group,
        account_name: emp.account_name,
        account_number: emp.account_number,
        bank_name: emp.bank_name,
        ifsc_code: emp.ifsc_code,
        designation: emp.designation,
        team_head: Boolean(emp.team_head),
        employment_type: emp.employment_type,
        working_status: emp.working_status,
        join_date: emp.join_date,
        intern_start_date: emp.intern_start_date,
        intern_end_date: emp.intern_end_date,
        duration_months: emp.duration_months,
        address: emp.address,
        profile_url: emp.profile_url,
        resume_url: emp.resume_url,
        offer_letter_url: emp.offer_letter_url,
        ID_url,
        Certificates_url,
        otherDocs_url,
        exit_docs_url,
      };
    });

    res.json({
      status: true,
      employees: employees,
    });
  });
});

// Check username availability
router.get("/check/:username", (req, res) => {
  const { username } = req.params;
  console.log(`Checking username: ${username}`);

  const query =
    "SELECT employee_id FROM employees_details WHERE employee_id = ?";

  db.pool.query(query, [username], (err, results) => {
    if (err) {
      console.error("Check error:", err);
      return res.status(500).json({
        available: false,
        error: err.message,
      });
    }

    res.json({
      available: results.length === 0,
    });
  });
});

// POST - Insert new employee
router.post("/", uploadFields, (req, res) => {
  const data = req.body;

  if (!data.userName || !data.employeeName) {
    return res.status(400).json({
      status: false,
      message: "Employee ID and Name are required",
    });
  }

  const teamHead =
    data.teamHead === "true" || data.teamHead === true || data.teamHead === "1"
      ? 1
      : 0;

  // Determine intern_id based on employment type
  let internId = null;
  if (data.employmentType === "Intern") {
    internId = data.userName; // Same as employee_id for interns
  }

  const processFiles = (fileType) => {
    const fileData = {};
    const files = req.files;

    if (!files) return fileData;

    if (fileType === "ids") {
      if (files.aadhar) {
        fileData.aadhar = {
          originalName: files.aadhar[0].originalname,
          path: `/Images/ids/${files.aadhar[0].filename}`,
        };
      }
      if (files.panCard) {
        fileData.panCard = {
          originalName: files.panCard[0].originalname,
          path: `/Images/ids/${files.panCard[0].filename}`,
        };
      }
      if (files.voterId) {
        fileData.voterId = {
          originalName: files.voterId[0].originalname,
          path: `/Images/ids/${files.voterId[0].filename}`,
        };
      }
      if (files.drivingLicense) {
        fileData.drivingLicense = {
          originalName: files.drivingLicense[0].originalname,
          path: `/Images/ids/${files.drivingLicense[0].filename}`,
        };
      }
    }

    if (fileType === "certificates") {
      if (files.tenth) {
        fileData.tenth = {
          originalName: files.tenth[0].originalname,
          path: `/Images/certificates/${files.tenth[0].filename}`,
        };
      }
      if (files.twelfth) {
        fileData.twelfth = {
          originalName: files.twelfth[0].originalname,
          path: `/Images/certificates/${files.twelfth[0].filename}`,
        };
      }
      if (files.degree) {
        fileData.degree = {
          originalName: files.degree[0].originalname,
          path: `/Images/certificates/${files.degree[0].filename}`,
        };
      }
      if (files.probation) {
        fileData.probation = {
          originalName: files.probation[0].originalname,
          path: `/Images/certificates/${files.probation[0].filename}`,
        };
      }
    }

    if (fileType === "others" && files.otherDocs) {
      return files.otherDocs.map((file) => ({
        originalName: file.originalname,
        path: `/Images/others/${file.filename}`,
      }));
    }

    if (fileType === "exit") {
      if (files.paySlip) {
        fileData.paySlip = {
          originalName: files.paySlip[0].originalname,
          path: `/Images/exit_docs/${files.paySlip[0].filename}`,
        };
      }
      if (files.experienceLetter) {
        fileData.experienceLetter = {
          originalName: files.experienceLetter[0].originalname,
          path: `/Images/exit_docs/${files.experienceLetter[0].filename}`,
        };
      }
      if (files.relievingLetter) {
        fileData.relievingLetter = {
          originalName: files.relievingLetter[0].originalname,
          path: `/Images/exit_docs/${files.relievingLetter[0].filename}`,
        };
      }
    }

    return fileData;
  };

  const idsData = processFiles("ids");
  const certificatesData = processFiles("certificates");
  const otherDocsData = processFiles("others");
  const exitDocsData = processFiles("exit");

  const profileUrl = req.files?.profile
    ? `/Images/profiles/${req.files.profile[0].filename}`
    : null;
  const resumeUrl = req.files?.resume
    ? `/Images/resumes/${req.files.resume[0].filename}`
    : null;
  const offerLetterUrl = req.files?.offerLetter
    ? `/Images/offer_letters/${req.files.offerLetter[0].filename}`
    : null;

  console.log("Employee ID:", data.userName);
  console.log("Intern ID:", internId);
  console.log("Employment Type:", data.employmentType);

  const query = `
    INSERT INTO employees_details 
    (employee_id, intern_id, employee_name, dob, gender, 
     email_personal, email_official, phone_personal, phone_official,
     phone_alternative, phone_relation, blood_group,
     account_name, account_number, bank_name, ifsc_code,
     designation, team_head, employment_type, working_status,
     join_date, intern_start_date, intern_end_date, duration_months,
     address, password, profile_url, resume_url, offer_letter_url,
     ID_url, Certificates_url, otherDocs_url, exit_docs_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.pool.query(
    query,
    [
      data.userName,
      internId,
      data.employeeName,
      data.dob || null,
      data.gender || null,
      data.emailPersonal || null,
      data.emailOfficial || null,
      data.phonePersonal || null,
      data.phoneOfficial || null,
      data.phoneAlternative || null,
      data.phoneRelation || null,
      data.bloodGroup || null,
      data.AccountName || null,
      data.AccountNumber || null,
      data.BankName || null,
      data.IFSCCode || null,
      data.designation || null,
      teamHead,
      data.employmentType || "On Role",
      data.workingStatus || "Active",
      data.doj || null,
      data.internStartDate || null,
      data.internEndDate || null,
      data.durationMonths || null,
      data.address || null,
      data.password || null,
      profileUrl,
      resumeUrl,
      offerLetterUrl,
      JSON.stringify(idsData),
      JSON.stringify(certificatesData),
      JSON.stringify(otherDocsData),
      JSON.stringify(exitDocsData),
    ],
    (err, result) => {
      if (err) {
        console.error("Insert error:", err);
        return res.status(500).json({
          status: false,
          message: "DB error",
          error: err.message,
        });
      }

      console.log("Employee added successfully, ID:", result.insertId);
      res.json({
        status: true,
        message: "Employee added successfully",
        id: result.insertId,
      });
    }
  );
});

// PUT - Update profile only (legacy support)
router.put("/:id", uploadFields, (req, res) => {
  const { id } = req.params;
  const data = req.body;

  if (
    req.files?.profile &&
    Object.keys(data).length <= 1 &&
    data.userName === id
  ) {
    console.log("Profile-only update detected");

    const profileUrl = `/Images/profiles/${req.files.profile[0].filename}`;

    const updateQuery = `UPDATE employees_details SET profile_url = ? WHERE employee_id = ?`;

    db.pool.query(updateQuery, [profileUrl, id], (err, result) => {
      if (err) {
        console.error("Profile update error:", err);
        return res.status(500).json({
          status: false,
          message: "DB error",
          error: err.message,
        });
      }

      res.json({
        status: true,
        message: "Profile updated successfully",
      });
    });
    return;
  }

  const selectQuery = `SELECT profile_url, resume_url, offer_letter_url, ID_url, Certificates_url, otherDocs_url, exit_docs_url 
                        FROM employees_details WHERE employee_id = ?`;

  db.pool.query(selectQuery, [id], (err, results) => {
    if (err) {
      console.error("Select error:", err);
      return res.status(500).json({
        status: false,
        message: "DB error",
        error: err.message,
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Employee not found",
      });
    }
  });
});

// PUT - Update employee (main update endpoint)
router.put("/updateEmployee/:id", uploadFields, (req, res) => {
  const employeeId = req.params.id;
  console.log("Updating employee:", employeeId);
  const data = req.body;

  if (!data.userName || !data.employeeName) {
    return res.status(400).json({
      status: false,
      message: "Employee ID and Name are required",
    });
  }

  const teamHead =
    data.teamHead === "true" || data.teamHead === true || data.teamHead === "1"
      ? 1
      : 0;

  // Determine intern_id logic
  let internId = null;
  if (data.employmentType === "Intern") {
    // For Intern: store same ID in both employee_id and intern_id
    internId = data.userName;
  } else if (data.internId) {
    // For On Role with existing intern_id: keep the intern_id
    internId = data.internId;
  }

  const getExistingQuery = `
    SELECT employee_id, intern_id, profile_url, resume_url, offer_letter_url, ID_url, Certificates_url, otherDocs_url, exit_docs_url 
    FROM employees_details 
    WHERE employee_id = ?
  `;

  db.pool.query(getExistingQuery, [employeeId], (err, existingData) => {
    if (err) {
      console.error("Error fetching existing data:", err);
      return res.status(500).json({
        status: false,
        message: "DB error",
        error: err.message,
      });
    }

    if (existingData.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Employee not found",
      });
    }

    const existing = existingData[0];

    const processFiles = (fileType) => {
      const fileData = {};
      const files = req.files;

      if (!files) return fileData;

      if (fileType === "ids") {
        if (files.aadhar) {
          fileData.aadhar = {
            originalName: files.aadhar[0].originalname,
            path: `/Images/ids/${files.aadhar[0].filename}`,
          };
        }
        if (files.panCard) {
          fileData.panCard = {
            originalName: files.panCard[0].originalname,
            path: `/Images/ids/${files.panCard[0].filename}`,
          };
        }
        if (files.voterId) {
          fileData.voterId = {
            originalName: files.voterId[0].originalname,
            path: `/Images/ids/${files.voterId[0].filename}`,
          };
        }
        if (files.drivingLicense) {
          fileData.drivingLicense = {
            originalName: files.drivingLicense[0].originalname,
            path: `/Images/ids/${files.drivingLicense[0].filename}`,
          };
        }
      }

      if (fileType === "certificates") {
        if (files.tenth) {
          fileData.tenth = {
            originalName: files.tenth[0].originalname,
            path: `/Images/certificates/${files.tenth[0].filename}`,
          };
        }
        if (files.twelfth) {
          fileData.twelfth = {
            originalName: files.twelfth[0].originalname,
            path: `/Images/certificates/${files.twelfth[0].filename}`,
          };
        }
        if (files.degree) {
          fileData.degree = {
            originalName: files.degree[0].originalname,
            path: `/Images/certificates/${files.degree[0].filename}`,
          };
        }
        if (files.probation) {
          fileData.probation = {
            originalName: files.probation[0].originalname,
            path: `/Images/certificates/${files.probation[0].filename}`,
          };
        }
      }

      if (fileType === "others" && files.otherDocs) {
        return files.otherDocs.map((file) => ({
          originalName: file.originalname,
          path: `/Images/others/${file.filename}`,
        }));
      }

      if (fileType === "exit") {
        if (files.paySlip) {
          fileData.paySlip = {
            originalName: files.paySlip[0].originalname,
            path: `/Images/exit_docs/${files.paySlip[0].filename}`,
          };
        }
        if (files.experienceLetter) {
          fileData.experienceLetter = {
            originalName: files.experienceLetter[0].originalname,
            path: `/Images/exit_docs/${files.experienceLetter[0].filename}`,
          };
        }
        if (files.relievingLetter) {
          fileData.relievingLetter = {
            originalName: files.relievingLetter[0].originalname,
            path: `/Images/exit_docs/${files.relievingLetter[0].filename}`,
          };
        }
      }

      return fileData;
    };

    const newIdsData = processFiles("ids");
    const newCertificatesData = processFiles("certificates");
    const newOtherDocsData = processFiles("others");
    const newExitDocsData = processFiles("exit");

    let existingIds = {};
    let existingCerts = {};
    let existingOthers = [];
    let existingExitDocs = {};

    try {
      existingIds = existing.ID_url ? JSON.parse(existing.ID_url) : {};
      existingCerts = existing.Certificates_url
        ? JSON.parse(existing.Certificates_url)
        : {};
      existingOthers = existing.otherDocs_url
        ? JSON.parse(existing.otherDocs_url)
        : [];
      existingExitDocs = existing.exit_docs_url
        ? JSON.parse(existing.exit_docs_url)
        : {};
    } catch (parseErr) {
      console.error("Error parsing existing JSON:", parseErr);
    }

    const finalIdsData = { ...existingIds, ...newIdsData };
    const finalCertificatesData = { ...existingCerts, ...newCertificatesData };
    const finalOtherDocsData =
      newOtherDocsData.length > 0 ? newOtherDocsData : existingOthers;
    const finalExitDocsData = { ...existingExitDocs, ...newExitDocsData };

    const profileUrl = req.files?.profile
      ? `/Images/profiles/${req.files.profile[0].filename}`
      : existing.profile_url;
    const resumeUrl = req.files?.resume
      ? `/Images/resumes/${req.files.resume[0].filename}`
      : existing.resume_url;
    const offerLetterUrl = req.files?.offerLetter
      ? `/Images/offer_letters/${req.files.offerLetter[0].filename}`
      : existing.offer_letter_url;

    console.log("New Employee ID:", data.userName);
    console.log("Intern ID:", internId);
    console.log("Old Employee ID:", employeeId);

    const updateQuery = `
      UPDATE employees_details 
      SET 
        employee_id = ?,
        intern_id = ?,
        employee_name = ?,
        dob = ?,
        gender = ?,
        email_personal = ?,
        email_official = ?,
        phone_personal = ?,
        phone_official = ?,
        phone_alternative = ?,
        phone_relation = ?,
        blood_group = ?,
        account_name = ?,
        account_number = ?,
        bank_name = ?,
        ifsc_code = ?,
        designation = ?,
        team_head = ?,
        employment_type = ?,
        working_status = ?,
        join_date = ?,
        intern_start_date = ?,
        intern_end_date = ?,
        duration_months = ?,
        address = ?,
        profile_url = ?,
        resume_url = ?,
        offer_letter_url = ?,
        ID_url = ?,
        Certificates_url = ?,
        otherDocs_url = ?,
        exit_docs_url = ?
      WHERE employee_id = ?
    `;

    db.pool.query(
      updateQuery,
      [
        data.userName, // New employee_id
        internId, // intern_id (same as employee_id for Intern, kept for On Role if was Intern)
        data.employeeName,
        data.dob || null,
        data.gender || null,
        data.emailPersonal || null,
        data.emailOfficial || null,
        data.phonePersonal || null,
        data.phoneOfficial || null,
        data.phoneAlternative || null,
        data.phoneRelation || null,
        data.bloodGroup || null,
        data.AccountName || null,
        data.AccountNumber || null,
        data.BankName || null,
        data.IFSCCode || null,
        data.designation || null,
        teamHead,
        data.employmentType || "On Role",
        data.workingStatus || "Active",
        data.doj || null,
        data.internStartDate || null,
        data.internEndDate || null,
        data.durationMonths || null,
        data.address || null,
        profileUrl,
        resumeUrl,
        offerLetterUrl,
        JSON.stringify(finalIdsData),
        JSON.stringify(finalCertificatesData),
        JSON.stringify(finalOtherDocsData),
        JSON.stringify(finalExitDocsData),
        employeeId, // WHERE condition uses old employee_id
      ],
      (err, result) => {
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
            message: "Employee not found",
          });
        }

        console.log("Employee updated successfully, New ID:", data.userName);
        res.json({
          status: true,
          message: "Employee updated successfully",
          id: data.userName,
        });
      }
    );
  });
});

// DELETE file route
router.delete("/deleteFile/:id", (req, res) => {
  const employeeId = req.params.id;
  const { fieldName } = req.body;

  console.log(`Deleting file for employee ${employeeId}, field: ${fieldName}`);

  if (!fieldName) {
    return res.status(400).json({
      status: false,
      message: "Field name is required",
    });
  }

  // Map field names to database columns and JSON keys
  const fieldMapping = {
    resume: { column: "resume_url", jsonKey: null },
    offerLetter: { column: "offer_letter_url", jsonKey: null },
    aadhar: { column: "ID_url", jsonKey: "aadhar" },
    panCard: { column: "ID_url", jsonKey: "panCard" },
    voterId: { column: "ID_url", jsonKey: "voterId" },
    drivingLicense: { column: "ID_url", jsonKey: "drivingLicense" },
    tenth: { column: "Certificates_url", jsonKey: "tenth" },
    twelfth: { column: "Certificates_url", jsonKey: "twelfth" },
    degree: { column: "Certificates_url", jsonKey: "degree" },
    probation: { column: "Certificates_url", jsonKey: "probation" },
    paySlip: { column: "exit_docs_url", jsonKey: "paySlip" },
    experienceLetter: { column: "exit_docs_url", jsonKey: "experienceLetter" },
    relievingLetter: { column: "exit_docs_url", jsonKey: "relievingLetter" },
  };

  const mapping = fieldMapping[fieldName];

  if (!mapping) {
    return res.status(400).json({
      status: false,
      message: "Invalid field name",
    });
  }

  // Get current data
  const selectQuery = `SELECT ${mapping.column} FROM employees_details WHERE employee_id = ?`;

  db.pool.query(selectQuery, [employeeId], (err, results) => {
    if (err) {
      console.error("Select error:", err);
      return res.status(500).json({
        status: false,
        message: "DB error",
        error: err.message,
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Employee not found",
      });
    }

    const currentData = results[0][mapping.column];
    let filePath = null;

    // Handle JSON columns
    if (mapping.jsonKey) {
      try {
        const jsonData = currentData ? JSON.parse(currentData) : {};
        if (jsonData[mapping.jsonKey]) {
          filePath = jsonData[mapping.jsonKey].path;
          delete jsonData[mapping.jsonKey];

          // Update database with modified JSON
          const updateQuery = `UPDATE employees_details SET ${mapping.column} = ? WHERE employee_id = ?`;
          db.pool.query(
            updateQuery,
            [JSON.stringify(jsonData), employeeId],
            (updateErr) => {
              if (updateErr) {
                console.error("Update error:", updateErr);
                return res.status(500).json({
                  status: false,
                  message: "Failed to update database",
                });
              }

              // Delete physical file
              if (filePath) {
                const fullPath = path.join(__dirname, "../..", filePath);
                fs.unlink(fullPath, (unlinkErr) => {
                  if (unlinkErr) {
                    console.error("File deletion error:", unlinkErr);
                  }
                });
              }

              res.json({
                status: true,
                message: "Document deleted successfully",
              });
            }
          );
        } else {
          return res.status(404).json({
            status: false,
            message: "Document not found",
          });
        }
      } catch (parseErr) {
        console.error("JSON parse error:", parseErr);
        return res.status(500).json({
          status: false,
          message: "Failed to parse document data",
        });
      }
    } else {
      // Handle direct column (resume, offerLetter)
      filePath = currentData;

      const updateQuery = `UPDATE employees_details SET ${mapping.column} = NULL WHERE employee_id = ?`;
      db.pool.query(updateQuery, [employeeId], (updateErr) => {
        if (updateErr) {
          console.error("Update error:", updateErr);
          return res.status(500).json({
            status: false,
            message: "Failed to update database",
          });
        }

        // Delete physical file
        if (filePath) {
          const fullPath = path.join(__dirname, "../..", filePath);
          fs.unlink(fullPath, (unlinkErr) => {
            if (unlinkErr) {
              console.error("File deletion error:", unlinkErr);
            }
          });
        }

        res.json({
          status: true,
          message: "Document deleted successfully",
        });
      });
    }
  });
});

// DELETE employee
router.delete("/:id", (req, res) => {
  const { id } = req.params;
  console.log("Deleting employee:", id);

  const query = "DELETE FROM employees_details WHERE employee_id = ?";

  db.pool.query(query, [id], (err, result) => {
    if (err) {
      console.error("Delete error:", err);
      return res.status(500).json({
        status: false,
        message: "DB error",
        error: err.message,
      });
    }

    res.json({
      status: true,
      message: "Employee deleted successfully",
    });
  });
});

// PUT - Change password
router.put("/:id/change-password", (req, res) => {
  const { id } = req.params;
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({
      status: false,
      message: "Old and new password are required",
    });
  }

  if (oldPassword === newPassword) {
    return res.status(400).json({
      status: false,
      message: "New password must be different from old password",
    });
  }

  const selectQuery =
    "SELECT password FROM employees_details WHERE employee_id = ?";

  db.pool.query(selectQuery, [id], (err, results) => {
    if (err) {
      console.error("Select password error:", err);
      return res.status(500).json({
        status: false,
        message: "DB error",
        error: err.message,
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Employee not found",
      });
    }

    const currentPassword = results[0].password;

    if (currentPassword !== oldPassword) {
      return res.status(400).json({
        status: false,
        message: "Old password is incorrect",
      });
    }

    const updateQuery =
      "UPDATE employees_details SET password = ? WHERE employee_id = ?";

    db.pool.query(updateQuery, [newPassword, id], (err2) => {
      if (err2) {
        console.error("Update password error:", err2);
        return res.status(500).json({
          status: false,
          message: "DB error",
          error: err2.message,
        });
      }

      return res.json({
        status: true,
        message: "Password updated successfully",
      });
    });
  });
});

// GET single employee by employee_id
router.get("/:id", (req, res) => {
  const { id } = req.params;

  const query = `
    SELECT 
      employee_id, intern_id, employee_name, dob, gender,
      email_personal, email_official, phone_personal, phone_official,
      phone_alternative, phone_relation, blood_group,
      account_name, account_number, bank_name, ifsc_code,
      designation, team_head, employment_type, working_status,
      join_date, intern_start_date, intern_end_date, duration_months,
      address, profile_url
    FROM employees_details
    WHERE employee_id = ?
  `;

  db.pool.query(query, [id], (err, results) => {
    if (err) {
      console.error("Fetch single employee error:", err);
      return res.status(500).json({
        status: false,
        message: "DB error",
        error: err.message,
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Employee not found",
      });
    }

    const emp = results[0];

    res.json({
      status: true,
      employee: {
        employeeId: emp.employee_id,
        internId: emp.intern_id,
        employeeName: emp.employee_name,
        dob: emp.dob,
        gender: emp.gender,
        emailPersonal: emp.email_personal,
        emailOfficial: emp.email_official,
        phonePersonal: emp.phone_personal,
        phoneOfficial: emp.phone_official,
        phoneAlternative: emp.phone_alternative,
        phoneRelation: emp.phone_relation,
        bloodGroup: emp.blood_group,
        accountName: emp.account_name,
        accountNumber: emp.account_number,
        bankName: emp.bank_name,
        ifscCode: emp.ifsc_code,
        designation: emp.designation,
        employmentType: emp.employment_type,
        workingStatus: emp.working_status,
        doj: emp.join_date,
        internStartDate: emp.intern_start_date,
        internEndDate: emp.intern_end_date,
        durationMonths: emp.duration_months,
        address: emp.address,
        profile: emp.profile_url,
      },
    });
  });
});

// DELETE individual other document
router.delete("/deleteOtherDoc/:id", (req, res) => {
  const employeeId = req.params.id;
  const { docIndex } = req.body;

  console.log(`Deleting other document ${docIndex} for employee ${employeeId}`);

  if (docIndex === undefined || docIndex === null) {
    return res.status(400).json({
      status: false,
      message: "Document index is required",
    });
  }

  // Get current data
  const selectQuery = `SELECT otherDocs_url FROM employees_details WHERE employee_id = ?`;

  db.pool.query(selectQuery, [employeeId], (err, results) => {
    if (err) {
      console.error("Select error:", err);
      return res.status(500).json({
        status: false,
        message: "DB error",
        error: err.message,
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Employee not found",
      });
    }

    const currentData = results[0].otherDocs_url;
    
    try {
      const otherDocs = currentData ? JSON.parse(currentData) : [];
      
      if (docIndex < 0 || docIndex >= otherDocs.length) {
        return res.status(404).json({
          status: false,
          message: "Document not found",
        });
      }

      const docToDelete = otherDocs[docIndex];
      const filePath = docToDelete.path;

      // Remove from array
      otherDocs.splice(docIndex, 1);

      // Update database
      const updateQuery = `UPDATE employees_details SET otherDocs_url = ? WHERE employee_id = ?`;
      db.pool.query(
        updateQuery,
        [JSON.stringify(otherDocs), employeeId],
        (updateErr) => {
          if (updateErr) {
            console.error("Update error:", updateErr);
            return res.status(500).json({
              status: false,
              message: "Failed to update database",
            });
          }

          // Delete physical file
          if (filePath) {
            const fullPath = path.join(__dirname, "../..", filePath);
            fs.unlink(fullPath, (unlinkErr) => {
              if (unlinkErr) {
                console.error("File deletion error:", unlinkErr);
              }
            });
          }

          res.json({
            status: true,
            message: "Document deleted successfully",
          });
        }
      );
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr);
      return res.status(500).json({
        status: false,
        message: "Failed to parse document data",
      });
    }
  });
});


module.exports = router;
