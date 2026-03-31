const express = require("express");
const router = express.Router();
const { queryWithRetry } = require("../../dataBase/connection");

// ✅ Get employees with names
router.get("/employees", async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT 
        c.employee_id,
        COALESCE(ed.employee_name, c.employee_id) as employee_name
      FROM (
        SELECT DISTINCT employee_id 
        FROM ClientsData 
        WHERE employee_id IS NOT NULL
        UNION
        SELECT DISTINCT employee_id 
        FROM Followups 
        WHERE employee_id IS NOT NULL
      ) c
      LEFT JOIN employees_details ed ON c.employee_id = ed.employee_id
      ORDER BY ed.employee_name, c.employee_id
    `;

    const result = await queryWithRetry(query);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("❌ Error fetching employees:", error);

    try {
      const fallbackQuery = `
        SELECT DISTINCT 
          employee_id,
          employee_id as employee_name
        FROM (
          SELECT DISTINCT employee_id FROM ClientsData WHERE employee_id IS NOT NULL
          UNION
          SELECT DISTINCT employee_id FROM Followups WHERE employee_id IS NOT NULL
        ) AS combined
        ORDER BY employee_id
      `;

      const fallbackResult = await queryWithRetry(fallbackQuery);
      res.status(200).json({ success: true, data: fallbackResult });
    } catch (fallbackError) {
      res.status(500).json({
        success: false,
        error: "Failed to fetch employees",
        message: fallbackError.message,
      });
    }
  }
});

// ✅ Get analytics overview with MISSED FOLLOWUP in pie charts
router.get("/overview", async (req, res) => {
  try {
    const { employee_id, from_date, to_date } = req.query; // ADD DATE PARAMETERS

    // 1. Total Customers with date filter
    const totalCustomersQuery = `
      SELECT COUNT(*) as total 
      FROM ClientsData 
      WHERE active = 1
      ${from_date ? "AND DATE(created_at) >= ?" : ""}
      ${to_date ? "AND DATE(created_at) <= ?" : ""}
      ${employee_id ? "AND employee_id = ?" : ""}
    `;
    
    // Build parameters array
    const totalParams = [];
    if (from_date) totalParams.push(from_date);
    if (to_date) totalParams.push(to_date);
    if (employee_id) totalParams.push(employee_id);
    
    const totalCustomersResult = await queryWithRetry(
      totalCustomersQuery,
      totalParams
    );
    const totalCustomers = totalCustomersResult[0].total;

    // 2. Get latest status for each client with date filter
    const latestStatusQuery = `
      SELECT 
        f1.clientID,
        f1.status,
        f1.nextFollowupDate,
        f1.created_at as followup_date
      FROM Followups f1
      INNER JOIN (
        SELECT clientID, MAX(id) as max_id
        FROM Followups
        WHERE 1=1
        ${from_date ? "AND DATE(created_at) >= ?" : ""}
        ${to_date ? "AND DATE(created_at) <= ?" : ""}
        ${employee_id ? "AND employee_id = ?" : ""}
        GROUP BY clientID
      ) f2 ON f1.clientID = f2.clientID AND f1.id = f2.max_id
      INNER JOIN ClientsData c ON f1.clientID = c.id
      WHERE c.active = 1
      ${from_date ? "AND DATE(c.created_at) >= ?" : ""}
      ${to_date ? "AND DATE(c.created_at) <= ?" : ""}
      ${employee_id ? "AND c.employee_id = ?" : ""}
    `;
    
    // Build parameters for latest status query
    const latestParams = [];
    if (from_date) latestParams.push(from_date);
    if (to_date) latestParams.push(to_date);
    if (employee_id) latestParams.push(employee_id);
    
    if (from_date) latestParams.push(from_date);
    if (to_date) latestParams.push(to_date);
    if (employee_id) latestParams.push(employee_id);
    
    const latestStatuses = await queryWithRetry(
      latestStatusQuery,
      latestParams
    );

    // 3. Count clients with no followups with date filter
    const noFollowupQuery = `
      SELECT COUNT(*) as count
      FROM ClientsData c
      LEFT JOIN Followups f ON c.id = f.clientID
      WHERE f.clientID IS NULL 
        AND c.active = 1
        ${from_date ? "AND DATE(c.created_at) >= ?" : ""}
        ${to_date ? "AND DATE(c.created_at) <= ?" : ""}
        ${employee_id ? "AND c.employee_id = ?" : ""}
    `;
    
    const noFollowupParams = [];
    if (from_date) noFollowupParams.push(from_date);
    if (to_date) noFollowupParams.push(to_date);
    if (employee_id) noFollowupParams.push(employee_id);
    
    const noFollowupResult = await queryWithRetry(
      noFollowupQuery,
      noFollowupParams
    );
    const noFollowupCount = noFollowupResult[0].count;

    // Initialize counters
    let firstFollowupCount = 0;
    let notSatrtedCount = noFollowupCount;
    let notReachableCount = 0;
    let notAvailableCount = 0;
    let notInterestedCount = 0;
    let secondFollowupCount = 0;
    let leadCount = 0;
    let dropCount = 0;

    // Separate missed followup counters for each category
    let firstFollowupMissed = 0;
    let secondFollowupMissed = 0;

    // Get today's date for comparison
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Count based on latest status + check for missed followups
    latestStatuses.forEach((row) => {
      const isMissed =
        row.nextFollowupDate && new Date(row.nextFollowupDate) < today;

      switch (row.status) {
        case "first_followup":
          firstFollowupCount++;
          if (isMissed) firstFollowupMissed++;
          break;
        case "not_reachable":
          notReachableCount++;
          if (isMissed) firstFollowupMissed++;
          break;
        case "not_available":
          notAvailableCount++;
          if (isMissed) firstFollowupMissed++;
          break;
        case "not_interested":
          notInterestedCount++;
          if (isMissed) firstFollowupMissed++;
          break;
        case "second_followup":
          secondFollowupCount++;
          if (isMissed) secondFollowupMissed++;
          break;
        case "converted":
          leadCount++;
          break;
        case "droped":
          dropCount++;
          break;
      }
    });

    const totalFirstFollowUp =
      firstFollowupCount +
      notReachableCount +
      notAvailableCount +
      notInterestedCount;

    const totalSecondFollowUp = secondFollowupCount + leadCount + dropCount;

    const response = {
      success: true,
      data: {
        totalCustomers: totalCustomers,
        notStarted: {
          total: notSatrtedCount,
        },
        firstFollowup: {
          total: totalFirstFollowUp,
          distribution: [
            { name: "Follow Up", value: firstFollowupCount },
            { name: "Not Picking / Not Reachable", value: notReachableCount },
            { name: "Not Available", value: notAvailableCount },
            { name: "Not Interested / Not Needed", value: notInterestedCount },
            { name: "Missed Follow Up", value: firstFollowupMissed },
          ],
        },
        secondFollowup: {
          total: totalSecondFollowUp,
          distribution: [
            { name: "In Progress", value: secondFollowupCount },
            { name: "Lead", value: leadCount },
            { name: "Drop", value: dropCount },
            { name: "Missed Follow Up", value: secondFollowupMissed },
          ],
        },
        dateRange: {
          from: from_date || null,
          to: to_date || null
        }
      },
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Error fetching analytics overview:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch analytics data",
      message: error.message,
    });
  }
});

// ✅ Get timeline for CURRENT MONTH ONLY with ALL DAYS
// ✅ Get timeline for CURRENT MONTH ONLY with ALL DAYS
router.get("/timeline", async (req, res) => {
  try {
    const { employee_id, from_date, to_date } = req.query;

    // Use provided dates or default to current month
    let firstDayStr, lastDayStr;

    if (from_date && to_date) {
      firstDayStr = from_date;
      lastDayStr = to_date;
    } else {
      // Default to current month
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      firstDayStr = firstDay.toISOString().split("T")[0];
      lastDayStr = lastDay.toISOString().split("T")[0];
    }

    const timelineQuery = `
      SELECT 
        f.id,
        f.clientID,
        f.status,
        DATE(f.created_at) AS followup_date,
        YEAR(f.created_at) AS year,
        MONTH(f.created_at) AS month_number,
        DAY(f.created_at) AS day_number,
        DATE_FORMAT(f.created_at, '%Y-%m-%d') AS date_key
      FROM Followups f
      INNER JOIN (
        SELECT clientID, MAX(id) as max_id
        FROM Followups
        ${employee_id ? "WHERE employee_id = ?" : ""}
        GROUP BY clientID
      ) latest ON f.clientID = latest.clientID AND f.id = latest.max_id
      INNER JOIN ClientsData c ON f.clientID = c.id
      WHERE c.active = 1
        AND f.status IN ('converted', 'droped')
        AND DATE(f.created_at) >= ?
        AND DATE(f.created_at) <= ?
        ${employee_id ? "AND f.employee_id = ?" : ""}
      ORDER BY followup_date ASC
    `;

    const timelineParams = employee_id
      ? [employee_id, firstDayStr, lastDayStr, employee_id]
      : [firstDayStr, lastDayStr];

    const rows = await queryWithRetry(timelineQuery, timelineParams);

    // Group by date
    const grouped = {};
    rows.forEach((r) => {
      const key = r.date_key;
      if (!grouped[key]) {
        grouped[key] = {
          date: key,
          year: r.year,
          month: r.month_number,
          day: r.day_number,
          lead_count: 0,
          drop_count: 0,
        };
      }
      if (r.status === "converted") grouped[key].lead_count += 1;
      if (r.status === "droped") grouped[key].drop_count += 1;
    });

    // ✅ FIXED: Generate all days in the selected range (timezone-safe)
    const allDays = [];
    
    // Parse dates in local timezone to avoid date shifting
    const [startYear, startMonth, startDay] = firstDayStr.split("-").map(Number);
    const [endYear, endMonth, endDay] = lastDayStr.split("-").map(Number);
    
    const startDate = new Date(startYear, startMonth - 1, startDay);
    const endDate = new Date(endYear, endMonth - 1, endDay);

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const dateKey = `${year}-${month}-${day}`;
      
      const dateLabel = d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });

      const dayData = grouped[dateKey];
      const total = dayData ? dayData.lead_count + dayData.drop_count : 0;

      allDays.push({
        date: dateKey,
        dateLabel: dateLabel,
        year: year,
        month: d.getMonth() + 1,
        day: d.getDate(),
        lead_count: dayData ? dayData.lead_count : 0,
        drop_count: dayData ? dayData.drop_count : 0,
        completed: total ? Math.round((dayData.lead_count / total) * 100) : 0,
        delayed: total ? Math.round((dayData.drop_count / total) * 100) : 0,
      });
    }

    res.status(200).json({
      success: true,
      data: allDays,
      dateRange: {
        from: firstDayStr,
        to: lastDayStr,
      },
    });
  } catch (error) {
    console.error("Error fetching timeline data:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch timeline data",
      message: error.message,
    });
  }
});


// ✅ Get report data
router.get("/report", async (req, res) => {
  try {
    const { employee_id } = req.query;

    const sql = `
      SELECT
        c.id AS clientID,
        c.company_name,
        c.customer_name,
        c.industry_type,
        c.city,
        c.state,
        c.created_at,
        cp.name AS contactName,
        cp.contactNumber,
        cp.designation,
        fu.status,
        fu.followupDate,
        fu.nextFollowupDate AS nextFollowupDate,
        CASE fu.status
          WHEN 'converted' THEN 'Lead'
          WHEN 'first_followup' THEN 'Follow Up'
          WHEN 'second_followup' THEN 'Second Follow Up'
          WHEN 'not_reachable' THEN 'Not Picking / Not Reachable'
          WHEN 'not_available' THEN 'Not Available'
          WHEN 'not_interested' THEN 'Not Interested / Not Needed'
          WHEN 'droped' THEN 'Drop'
          ELSE 'No Status'
        END AS statusLabel
      FROM ClientsData c
      LEFT JOIN (
        SELECT cp1.*
        FROM ContactPersons cp1
        INNER JOIN (
          SELECT clientID, MAX(updated_at) AS max_updated
          FROM ContactPersons
          GROUP BY clientID
        ) cp2
          ON cp1.clientID = cp2.clientID
         AND cp1.updated_at = cp2.max_updated
      ) cp ON cp.clientID = c.id
      LEFT JOIN (
        SELECT
          f1.clientID,
          f1.status,
          f1.created_at AS followupDate,
          f1.nextFollowupDate
        FROM Followups f1
        INNER JOIN (
          SELECT clientID, MAX(id) AS max_id
          FROM Followups
          ${employee_id ? "WHERE employee_id = ?" : ""}
          GROUP BY clientID
        ) f2
          ON f1.clientID = f2.clientID
         AND f1.id = f2.max_id
        ${employee_id ? "WHERE f1.employee_id = ?" : ""}
      ) fu ON fu.clientID = c.id
      WHERE c.active = 1
      ${employee_id ? "AND c.employee_id = ?" : ""}
      ORDER BY c.created_at DESC
    `;

    const reportParams = employee_id
      ? [employee_id, employee_id, employee_id]
      : [];
    const rows = await queryWithRetry(sql, reportParams);

    res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error("Report error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch report",
      message: err.message,
    });
  }
});

module.exports = router;
