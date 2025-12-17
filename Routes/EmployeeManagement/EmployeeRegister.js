const express = require('express');
const router = express.Router();
const db = require('../../dataBase/connection');
const uploadFields = require('../../middleware/uploadMiddleware');

// GET all employees
router.get("/", (req, res) => {
  console.log("GET /api/employeeRegister called");
  
  const query = `
    SELECT 
      employee_id, employee_name, dob, gender,
      email_personal, email_official, phone_personal, phone_official,
      designation, team_head, employment_type, working_status,
      join_date, intern_start_date, intern_end_date, duration_months,
      address, profile_url, resume_url,
      ID_url, Certificates_url, otherDocs_url
    FROM employees_details
    ORDER BY employee_id DESC
  `;

  db.pool.query(query, (err, results) => {  // ← CHANGED: db.pool.query
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

      try {
        ID_url = emp.ID_url ? JSON.parse(emp.ID_url) : {};
        Certificates_url = emp.Certificates_url ? JSON.parse(emp.Certificates_url) : {};
        otherDocs_url = emp.otherDocs_url ? JSON.parse(emp.otherDocs_url) : [];
      } catch (parseErr) {
        console.error("JSON parse error:", parseErr);
      }

      return {
        employee_id: emp.employee_id,
        employee_name: emp.employee_name,
        dob: emp.dob,
        gender: emp.gender,
        email_personal: emp.email_personal,
        email_official: emp.email_official,
        phone_personal: emp.phone_personal,
        phone_official: emp.phone_official,
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
        ID_url,
        Certificates_url,
        otherDocs_url,
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

  const query = "SELECT employee_id FROM employees_details WHERE employee_id = ?";

  db.pool.query(query, [username], (err, results) => {  // ← CHANGED
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

  const teamHead = data.teamHead === 'true' || data.teamHead === true || data.teamHead === '1' ? 1 : 0;

  const processFiles = (fileType) => {
    const fileData = {};
    const files = req.files;

    if (!files) return fileData;

    if (fileType === 'ids') {
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

    if (fileType === 'certificates') {
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

    if (fileType === 'others' && files.otherDocs) {
      return files.otherDocs.map((file) => ({
        originalName: file.originalname,
        path: `/Images/others/${file.filename}`,
      }));
    }

    return fileData;
  };

  const idsData = processFiles('ids');
  const certificatesData = processFiles('certificates');
  const otherDocsData = processFiles('others');

  const profileUrl = req.files?.profile 
    ? `/Images/profiles/${req.files.profile[0].filename}` 
    : null;
  const resumeUrl = req.files?.resume 
    ? `/Images/resumes/${req.files.resume[0].filename}` 
    : null;

  console.log("Profile URL:", profileUrl);
  console.log("Resume URL:", resumeUrl);

  const query = `
    INSERT INTO employees_details 
    (employee_id, employee_name, dob, gender, 
     email_personal, email_official, phone_personal, phone_official,
     designation, team_head, employment_type, working_status,
     join_date, intern_start_date, intern_end_date, duration_months,
     address, password, profile_url, resume_url,
     ID_url, Certificates_url, otherDocs_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.pool.query(  // ← CHANGED
    query,
    [
      data.userName,
      data.employeeName,
      data.dob || null,
      data.gender || null,
      data.emailPersonal || null,
      data.emailOfficial || null,
      data.phonePersonal || null,
      data.phoneOfficial || null,
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
      JSON.stringify(idsData),
      JSON.stringify(certificatesData),
      JSON.stringify(otherDocsData),
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


router.put("/:id", uploadFields, (req, res) => {

  const { id } = req.params;
  const data = req.body;

  if (req.files?.profile && Object.keys(data).length <= 1 && data.userName === id) {
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

  const selectQuery = `SELECT profile_url, resume_url, ID_url, Certificates_url, otherDocs_url 
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

  const teamHead = data.teamHead === 'true' || data.teamHead === true || data.teamHead === '1' ? 1 : 0;

  const getExistingQuery = `
    SELECT profile_url, resume_url, ID_url, Certificates_url, otherDocs_url 
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

      if (fileType === 'ids') {
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

      if (fileType === 'certificates') {
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

      if (fileType === 'others' && files.otherDocs) {
        return files.otherDocs.map((file) => ({
          originalName: file.originalname,
          path: `/Images/others/${file.filename}`,
        }));
      }

      return fileData;
    };

    const newIdsData = processFiles('ids');
    const newCertificatesData = processFiles('certificates');
    const newOtherDocsData = processFiles('others');

    let existingIds = {};
    let existingCerts = {};
    let existingOthers = [];

    try {
      existingIds = existing.ID_url ? JSON.parse(existing.ID_url) : {};
      existingCerts = existing.Certificates_url ? JSON.parse(existing.Certificates_url) : {};
      existingOthers = existing.otherDocs_url ? JSON.parse(existing.otherDocs_url) : [];
    } catch (parseErr) {
      console.error("Error parsing existing JSON:", parseErr);
    }

    const finalIdsData = { ...existingIds, ...newIdsData };
    const finalCertificatesData = { ...existingCerts, ...newCertificatesData };
    const finalOtherDocsData = newOtherDocsData.length > 0 ? newOtherDocsData : existingOthers;

    const profileUrl = req.files?.profile 
      ? `/Images/profiles/${req.files.profile[0].filename}` 
      : existing.profile_url;
    const resumeUrl = req.files?.resume 
      ? `/Images/resumes/${req.files.resume[0].filename}` 
      : existing.resume_url;

    console.log("Profile URL:", profileUrl);
    console.log("Resume URL:", resumeUrl);

    const updateQuery = `
      UPDATE employees_details 
      SET 
        employee_name = ?,
        dob = ?,
        gender = ?,
        email_personal = ?,
        email_official = ?,
        phone_personal = ?,
        phone_official = ?,
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
        ID_url = ?,
        Certificates_url = ?,
        otherDocs_url = ?
      WHERE employee_id = ?
    `;

    db.pool.query(
      updateQuery,
      [
        data.employeeName,
        data.dob || null,
        data.gender || null,
        data.emailPersonal || null,
        data.emailOfficial || null,
        data.phonePersonal || null,
        data.phoneOfficial || null,
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
        JSON.stringify(finalIdsData),
        JSON.stringify(finalCertificatesData),
        JSON.stringify(finalOtherDocsData),
        employeeId,
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

        console.log("Employee updated successfully, ID:", employeeId);
        res.json({
          status: true,
          message: "Employee updated successfully",
          id: employeeId,
        });
      }
    );
  });
});


// DELETE employee
router.delete("/:id", (req, res) => {
  const { id } = req.params;
  console.log("Deleting employee:", id);

  const query = "DELETE FROM employees_details WHERE employee_id = ?";

  db.pool.query(query, [id], (err, result) => {  // ← CHANGED
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
  const { id } = req.params; // employee_id
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

  const selectQuery = "SELECT password FROM employees_details WHERE employee_id = ?";

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
      employee_id, employee_name, dob, gender,
      email_personal, email_official, phone_personal, phone_official,
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
        employeeName: emp.employee_name,
        dob: emp.dob,
        gender: emp.gender,
        emailPersonal: emp.email_personal,
        emailOfficial: emp.email_official,
        phonePersonal: emp.phone_personal,
        phoneOfficial: emp.phone_official,
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


module.exports = router;
