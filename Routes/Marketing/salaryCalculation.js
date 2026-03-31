console.log("🚀 LOADING Salary Calculation route...");

const express = require("express");
const router = express.Router();
const { queryWithRetry } = require("../../dataBase/connection");

// ========== HELPER FUNCTION: Calculate Sundays in Month ==========
function getSundaysInMonth(month, year) {
  const daysInMonth = new Date(year, month, 0).getDate();
  let sundays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    if (date.getDay() === 0) sundays++;
  }
  return sundays;
}

// ========== HELPER FUNCTION: Calculate Salary ==========
function calculateSalaryBreakdown(basicSalary, month, year, totalLeaveDays, paidLeaveDays) {
  const totalDaysInMonth = new Date(year, month, 0).getDate();
  const sundays = getSundaysInMonth(month, year);
  const workingDays = totalDaysInMonth - sundays;
  const perDaySalary = basicSalary / workingDays;
  
  // Calculate unpaid leave deduction (supports 0.5 increments)
  const unpaidLeaveDays = Math.max(0, totalLeaveDays - paidLeaveDays);
  const totalDeductionAmount = perDaySalary * unpaidLeaveDays;
  
  return {
    totalDaysInMonth,
    sundays,
    workingDays,
    perDaySalary,
    unpaidLeaveDays,
    totalDeductionAmount
  };
}

// ========== GET ALL MONTHS OF CURRENT YEAR ==========
router.get("/months/:year", async (req, res) => {
  console.log("✅ GET SALARY MONTHS HIT!");
  try {
    const { year } = req.params;
    const currentYear = year || new Date().getFullYear();

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const months = monthNames.map((monthName, index) => {
      const monthNumber = index + 1;
      
      return {
        sno: monthNumber,
        year: parseInt(currentYear),
        month: monthName,
        month_number: monthNumber
      };
    });

    console.log(`✅ Generated ${months.length} months for year ${currentYear}`);
    res.json({ success: true, months });
  } catch (err) {
    console.error("Get months error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch months" });
  }
});

// ========== GET EMPLOYEES WITH SALARY DATA FOR A SPECIFIC MONTH ==========
router.get("/employees/:month/:year", async (req, res) => {
  console.log("✅ GET EMPLOYEES WITH SALARY HIT!");
  try {
    const { month, year } = req.params;

    const query = `
      SELECT 
        ed.employee_id,
        ed.employee_name,
        ed.profile_url,
        ed.designation,
        ed.employment_type,
        sc.id as salary_id,
        sc.basic_salary,
        sc.total_leave_days,
        sc.paid_leave_days,
        sc.deduction_amount,
        sc.total_deduction_days,
        sc.incentive,
        sc.bonus,
        sc.medical,
        sc.other_allowance,
        sc.total_salary,
        sc.created_at as salary_date
      FROM employees_details ed
      LEFT JOIN salary_calculation sc 
        ON ed.employee_id = sc.employee_id 
        AND sc.month = ? 
        AND sc.year = ?
      WHERE ed.working_status = 'Active'
      ORDER BY ed.employee_name ASC
    `;

    const results = await queryWithRetry(query, [month, year]);

    const employees = results.map((row) => ({
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      profile_url: row.profile_url || null,
      designation: row.designation,
      jobRole: row.employment_type || 'On Role',
      hasSalary: row.salary_id ? true : false,
      date: row.salary_date ? new Date(row.salary_date).toLocaleDateString('en-IN') : '-',
      salaryData: row.salary_id ? {
        id: row.salary_id,
        basicSalary: parseFloat(row.basic_salary),
        totalLeaveDays: row.total_leave_days,
        paidLeaveDays: row.paid_leave_days,
        deductionAmount: parseFloat(row.deduction_amount),
        totalDeductionDays: row.total_deduction_days,
        incentive: parseFloat(row.incentive),
        bonus: parseFloat(row.bonus),
        medical: parseFloat(row.medical),
        otherAllowance: parseFloat(row.other_allowance),
        totalSalary: parseFloat(row.total_salary)
      } : null
    }));

    console.log(`✅ Found ${employees.length} employees for ${month}/${year}`);
    res.json({ success: true, employees });
  } catch (err) {
    console.error("Get employees with salary error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch employees" });
  }
});

// ========== SEARCH EMPLOYEE BY ID ==========
router.get("/search-employee/:employeeId", async (req, res) => {
  console.log("✅ SEARCH EMPLOYEE HIT!");
  try {
    const { employeeId } = req.params;

    const query = `
      SELECT 
        employee_id,
        employee_name,
        designation,
        employment_type,
        profile_url
      FROM employees_details
      WHERE employee_id = ? AND working_status = 'Active'
    `;

    const results = await queryWithRetry(query, [employeeId]);

    if (results.length === 0) {
      return res.json({ 
        success: false, 
        error: "Employee not found or inactive" 
      });
    }

    const employee = {
      employee_id: results[0].employee_id,
      employee_name: results[0].employee_name,
      designation: results[0].designation,
      job_role: results[0].employment_type || 'On Role',
      profile_url: results[0].profile_url
    };

    console.log(`✅ Found employee: ${employee.employee_name}`);
    res.json({ success: true, employee });
  } catch (err) {
    console.error("Search employee error:", err);
    res.status(500).json({ success: false, error: "Failed to search employee" });
  }
});

// ========== SEARCH EMPLOYEES BY NAME ==========
router.get("/search-employees-by-name/:searchTerm", async (req, res) => {
  console.log("✅ SEARCH EMPLOYEES BY NAME HIT!");
  try {
    const { searchTerm } = req.params;

    const query = `
      SELECT 
        employee_id,
        employee_name,
        designation,
        employment_type,
        profile_url
      FROM employees_details
      WHERE working_status = 'Active' 
        AND (employee_name LIKE ? OR employee_id LIKE ?)
      ORDER BY employee_name ASC
      LIMIT 10
    `;

    const searchPattern = `%${searchTerm}%`;
    const results = await queryWithRetry(query, [searchPattern, searchPattern]);

    const employees = results.map(row => ({
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      designation: row.designation,
      job_role: row.employment_type || 'On Role',
      profile_url: row.profile_url
    }));

    console.log(`✅ Found ${employees.length} employees matching "${searchTerm}"`);
    res.json({ success: true, employees });
  } catch (err) {
    console.error("Search employees by name error:", err);
    res.status(500).json({ success: false, error: "Failed to search employees" });
  }
});

// ========== CREATE OR UPDATE SALARY ==========
router.post("/save-salary", async (req, res) => {
  console.log("✅ SAVE SALARY HIT!");
  try {
    const {
      employee_id,
      month,
      year,
      basic_salary,
      total_leave_days,
      paid_leave_days,
      incentive,
      bonus,
      medical,
      other_allowance,
      created_by
    } = req.body;

    // Validate required fields
    if (!employee_id || !month || !year || basic_salary === undefined) {
      return res.status(400).json({ 
        success: false, 
        error: "Employee ID, month, year, and basic salary are required" 
      });
    }

    // Validate leave days format (only 0.5 increments allowed)
    const validateHalfIncrement = (value) => {
      const num = parseFloat(value);
      return (num * 2) % 1 === 0; // Check if it's in 0.5 increments
    };

    if (!validateHalfIncrement(total_leave_days) || !validateHalfIncrement(paid_leave_days)) {
      return res.status(400).json({ 
        success: false, 
        error: "Leave days must be in 0.5 increments (e.g., 1, 1.5, 2, 2.5)" 
      });
    }

    // Calculate salary breakdown
    const breakdown = calculateSalaryBreakdown(
      parseFloat(basic_salary),
      parseInt(month),
      parseInt(year),
      parseFloat(total_leave_days || 0),
      parseFloat(paid_leave_days || 0)
    );

    // Calculate final total salary
    const totalSalary = 
      parseFloat(basic_salary) - 
      breakdown.totalDeductionAmount + 
      parseFloat(incentive || 0) + 
      parseFloat(bonus || 0) + 
      parseFloat(medical || 0) + 
      parseFloat(other_allowance || 0);

    // Check if salary record already exists
    const checkQuery = `
      SELECT id FROM salary_calculation 
      WHERE employee_id = ? AND month = ? AND year = ?
    `;
    const existing = await queryWithRetry(checkQuery, [employee_id, month, year]);

    let query;
    let params;

    if (existing.length > 0) {
      // Update existing record
      query = `
        UPDATE salary_calculation SET
          basic_salary = ?,
          total_leave_days = ?,
          paid_leave_days = ?,
          deduction_amount = ?,
          total_deduction_days = ?,
          incentive = ?,
          bonus = ?,
          medical = ?,
          other_allowance = ?,
          total_salary = ?,
          updated_by = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE employee_id = ? AND month = ? AND year = ?
      `;
      params = [
        basic_salary,
        total_leave_days || 0,
        paid_leave_days || 0,
        breakdown.totalDeductionAmount,
        breakdown.unpaidLeaveDays,
        incentive || 0,
        bonus || 0,
        medical || 0,
        other_allowance || 0,
        totalSalary,
        created_by || 'admin',
        employee_id,
        month,
        year
      ];
      console.log(`🔄 Updating salary for ${employee_id} - ${month}/${year} by ${created_by}`);
    } else {
      // Insert new record
      query = `
        INSERT INTO salary_calculation (
          employee_id, month, year, basic_salary,
          total_leave_days, paid_leave_days, deduction_amount,
          total_deduction_days, incentive, bonus, medical,
          other_allowance, total_salary, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      params = [
        employee_id,
        month,
        year,
        basic_salary,
        total_leave_days || 0,
        paid_leave_days || 0,
        breakdown.totalDeductionAmount,
        breakdown.unpaidLeaveDays,
        incentive || 0,
        bonus || 0,
        medical || 0,
        other_allowance || 0,
        totalSalary,
        created_by || 'admin'
      ];
      console.log(`➕ Creating new salary for ${employee_id} - ${month}/${year} by ${created_by}`);
    }

    await queryWithRetry(query, params);

    console.log(`✅ Salary ${existing.length > 0 ? 'updated' : 'created'} for employee ${employee_id}`);
    res.json({ 
      success: true, 
      message: `Salary ${existing.length > 0 ? 'updated' : 'created'} successfully`,
      breakdown // Return breakdown for frontend display
    });
  } catch (err) {
    console.error("Save salary error:", err);
    
    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(400).json({ 
        success: false, 
        error: "Employee ID does not exist in the system" 
      });
    }
    
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ 
        success: false, 
        error: "Salary record already exists for this employee and month" 
      });
    }
    
    res.status(500).json({ success: false, error: "Failed to save salary" });
  }
});

// ========== GET SALARY DETAILS BY ID ==========
router.get("/salary-details/:salaryId", async (req, res) => {
  console.log("✅ GET SALARY DETAILS HIT!");
  try {
    const { salaryId } = req.params;

    const query = `
      SELECT 
        sc.*,
        ed.employee_name,
        ed.designation,
        ed.employment_type,
        ed.profile_url
      FROM salary_calculation sc
      JOIN employees_details ed ON sc.employee_id = ed.employee_id
      WHERE sc.id = ?
    `;

    const results = await queryWithRetry(query, [salaryId]);

    if (results.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: "Salary record not found" 
      });
    }

    const salaryDetails = {
      id: results[0].id,
      employee_id: results[0].employee_id,
      employee_name: results[0].employee_name,
      designation: results[0].designation,
      job_role: results[0].employment_type || 'On Role',
      profile_url: results[0].profile_url,
      month: results[0].month,
      year: results[0].year,
      basic_salary: parseFloat(results[0].basic_salary),
      total_leave_days: results[0].total_leave_days,
      paid_leave_days: results[0].paid_leave_days,
      deduction_amount: parseFloat(results[0].deduction_amount),
      total_deduction_days: results[0].total_deduction_days,
      incentive: parseFloat(results[0].incentive),
      bonus: parseFloat(results[0].bonus),
      medical: parseFloat(results[0].medical),
      other_allowance: parseFloat(results[0].other_allowance),
      total_salary: parseFloat(results[0].total_salary),
      created_at: results[0].created_at,
      updated_at: results[0].updated_at
    };

    console.log(`✅ Salary details fetched for ID: ${salaryId}`);
    res.json({ success: true, salaryDetails });
  } catch (err) {
    console.error("Get salary details error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch salary details" });
  }
});

// ========== DELETE SALARY RECORD ==========
router.delete("/delete-salary/:salaryId", async (req, res) => {
  console.log("✅ DELETE SALARY HIT!");
  try {
    const { salaryId } = req.params;

    const checkQuery = `SELECT id FROM salary_calculation WHERE id = ?`;
    const existing = await queryWithRetry(checkQuery, [salaryId]);

    if (existing.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: "Salary record not found" 
      });
    }

    const query = `DELETE FROM salary_calculation WHERE id = ?`;
    await queryWithRetry(query, [salaryId]);

    console.log(`✅ Salary record ${salaryId} deleted`);
    res.json({ success: true, message: "Salary record deleted successfully" });
  } catch (err) {
    console.error("Delete salary error:", err);
    res.status(500).json({ success: false, error: "Failed to delete salary" });
  }
});

// ========== GET SALARY SUMMARY FOR MONTH ==========
router.get("/summary/:month/:year", async (req, res) => {
  console.log("✅ GET SALARY SUMMARY HIT!");
  try {
    const { month, year } = req.params;

    const query = `
      SELECT 
        COUNT(*) as total_employees,
        COUNT(sc.id) as employees_with_salary,
        SUM(sc.total_salary) as total_salary_amount,
        AVG(sc.total_salary) as average_salary,
        SUM(sc.basic_salary) as total_basic_salary,
        SUM(sc.incentive + sc.bonus + sc.medical + sc.other_allowance) as total_allowances,
        SUM(sc.deduction_amount) as total_deductions
      FROM employees_details ed
      LEFT JOIN salary_calculation sc 
        ON ed.employee_id = sc.employee_id 
        AND sc.month = ? 
        AND sc.year = ?
      WHERE ed.working_status = 'Active'
    `;

    const results = await queryWithRetry(query, [month, year]);

    const summary = {
      total_employees: results[0].total_employees || 0,
      employees_with_salary: results[0].employees_with_salary || 0,
      employees_pending: (results[0].total_employees || 0) - (results[0].employees_with_salary || 0),
      total_salary_amount: parseFloat(results[0].total_salary_amount || 0),
      average_salary: parseFloat(results[0].average_salary || 0),
      total_basic_salary: parseFloat(results[0].total_basic_salary || 0),
      total_allowances: parseFloat(results[0].total_allowances || 0),
      total_deductions: parseFloat(results[0].total_deductions || 0)
    };

    console.log(`✅ Summary fetched for ${month}/${year}`);
    res.json({ success: true, summary });
  } catch (err) {
    console.error("Get summary error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch summary" });
  }
});

// ========== UPDATE LEAVE DAYS (For HR) - Auto-create if not exists ==========
router.post("/update-leave", async (req, res) => {
  console.log("✅ UPDATE LEAVE HIT!");
  try {
    const { employee_id, month, year, total_leave_days, paid_leave_days } = req.body;

    if (!employee_id || !month || !year) {
      return res.status(400).json({
        success: false,
        error: "Employee ID, month, and year are required",
      });
    }

    // Validate 0.5 increments
    const validateHalfIncrement = (value) => {
      const num = parseFloat(value);
      return (num * 2) % 1 === 0;
    };

    if (
      total_leave_days !== undefined &&
      !validateHalfIncrement(total_leave_days)
    ) {
      return res.status(400).json({
        success: false,
        error: "Leave days must be in 0.5 increments (e.g., 0.5, 1, 1.5, 2)",
      });
    }

    if (
      paid_leave_days !== undefined &&
      !validateHalfIncrement(paid_leave_days)
    ) {
      return res.status(400).json({
        success: false,
        error: "Leave days must be in 0.5 increments (e.g., 0.5, 1, 1.5, 2)",
      });
    }

    // Check if salary record exists
    const checkQuery = `
      SELECT id, basic_salary, incentive, bonus, medical, other_allowance 
      FROM salary_calculation 
      WHERE employee_id = ? AND month = ? AND year = ?
    `;
    const existing = await queryWithRetry(checkQuery, [
      employee_id,
      month,
      year,
    ]);

    let userName = "admin";
    try {
      const userDataString = sessionStorage?.getItem?.("user");
      if (userDataString) {
        const userData = JSON.parse(userDataString);
        userName = userData.userName || "admin";
      }
    } catch (error) {
      console.log("Using default user 'admin'");
    }

    if (existing.length === 0) {
      // 🆕 CREATE NEW RECORD if it doesn't exist
      console.log(
        `📝 Creating new salary record for ${employee_id} with leave data only`
      );

      // Get employee details
      const empQuery = `
        SELECT employee_name, designation, employment_type 
        FROM employees_details 
        WHERE employee_id = ?
      `;
      const empResult = await queryWithRetry(empQuery, [employee_id]);

      if (empResult.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Employee not found",
        });
      }

      // Calculate unpaid leave
      const totalLeave = parseFloat(total_leave_days || 0);
      const paidLeave = parseFloat(paid_leave_days || 0);
      const unpaidLeave = Math.max(0, totalLeave - paidLeave);

      // Insert new record with default values for salary components
      const insertQuery = `
        INSERT INTO salary_calculation (
          employee_id, month, year, 
          basic_salary, total_leave_days, paid_leave_days,
          deduction_amount, total_deduction_days,
          incentive, bonus, medical, other_allowance,
          total_salary, created_by
        ) VALUES (?, ?, ?, 0, ?, ?, 0, ?, 0, 0, 0, 0, 0, ?)
      `;

      await queryWithRetry(insertQuery, [
        employee_id,
        month,
        year,
        totalLeave,
        paidLeave,
        unpaidLeave,
        userName,
      ]);

      console.log(
        `✅ New salary record created for ${employee_id} with leave data`
      );
      return res.json({
        success: true,
        message: "Leave data saved successfully",
        isNewRecord: true,
      });
    } else {
      // 🔄 UPDATE EXISTING RECORD
      console.log(`🔄 Updating existing salary record for ${employee_id}`);

      const updateFields = [];
      const updateValues = [];

      if (total_leave_days !== undefined) {
        updateFields.push("total_leave_days = ?");
        updateValues.push(parseFloat(total_leave_days));
      }

      if (paid_leave_days !== undefined) {
        updateFields.push("paid_leave_days = ?");
        updateValues.push(parseFloat(paid_leave_days));
      }

      if (updateFields.length === 0) {
        return res.status(400).json({
          success: false,
          error: "No leave data to update",
        });
      }

      // Get current leave values or use provided ones
      const currentTotal =
        total_leave_days !== undefined
          ? parseFloat(total_leave_days)
          : parseFloat(existing[0].total_leave_days || 0);
      const currentPaid =
        paid_leave_days !== undefined
          ? parseFloat(paid_leave_days)
          : parseFloat(existing[0].paid_leave_days || 0);

      // Calculate unpaid leave and deduction
      const unpaidLeave = Math.max(0, currentTotal - currentPaid);
      const basicSalary = parseFloat(existing[0].basic_salary || 0);

      let deductionAmount = 0;
      if (basicSalary > 0) {
        const totalDaysInMonth = new Date(year, month, 0).getDate();
        const sundays = getSundaysInMonth(month, year);
        const workingDays = totalDaysInMonth - sundays;
        const perDaySalary = basicSalary / workingDays;
        deductionAmount = perDaySalary * unpaidLeave;

        // Recalculate total salary
        const totalSalary =
          basicSalary -
          deductionAmount +
          parseFloat(existing[0].incentive || 0) +
          parseFloat(existing[0].bonus || 0) +
          parseFloat(existing[0].medical || 0) +
          parseFloat(existing[0].other_allowance || 0);

        updateFields.push("deduction_amount = ?");
        updateValues.push(deductionAmount);

        updateFields.push("total_salary = ?");
        updateValues.push(totalSalary);
      }

      updateFields.push("total_deduction_days = ?");
      updateValues.push(unpaidLeave);

      updateFields.push("updated_at = CURRENT_TIMESTAMP");
      updateValues.push(employee_id, month, year);

      const updateQuery = `
        UPDATE salary_calculation 
        SET ${updateFields.join(", ")}
        WHERE employee_id = ? AND month = ? AND year = ?
      `;

      await queryWithRetry(updateQuery, updateValues);

      console.log(`✅ Leave data updated for ${employee_id}`);
      return res.json({
        success: true,
        message: "Leave data updated successfully",
        isNewRecord: false,
      });
    }
  } catch (err) {
    console.error("Update leave error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to update leave data",
    });
  }
});


// ========== TEST ROUTE ==========
router.get("/test", (req, res) => {
  console.log("✅ SALARY CALCULATION TEST ROUTE WORKS!");
  res.json({ success: true, message: "Salary Calculation route is working!" });
});

module.exports = router;
console.log("✅ Salary Calculation Route EXPORTED!");
