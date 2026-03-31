const express = require("express");
const router = express.Router();
const { queryWithRetry } = require("../../dataBase/connection");

router.post("/", async (req, res) => {
  const {
    employee_id,
    clientID,
    contactPersonID,
    status,
    remarks,
    nextFollowup,
    newContact = {},
    meetingData = {},
    shareViaEmail = false,
    shareViaWhatsApp = false,
    subTab,
    following
  } = req.body;

  if (!clientID || !status) {
    return res.status(400).json({
      error: "Client ID and status are required",
    });
  }

  if (!employee_id) {
    return res.status(400).json({
      error: "Employee ID is required",
    });
  }

  try {
    const hasAnyField =
      (newContact.name && newContact.name.trim()) ||
      (newContact.contactNumber && newContact.contactNumber.trim());

    let contactID = contactPersonID;

    if (hasAnyField && subTab === "not_available") {
      const result = await queryWithRetry(
        `INSERT INTO ContactPersons (clientID, name, contactNumber, email, designation) VALUES (?, ?, ?, ?, ?)`,
        [
          clientID,
          newContact.name || null,
          newContact.contactNumber || null,
          newContact.email || null,
          newContact.designation || null,
        ]
      );
      contactID = result.insertId;
    }

    let sharedStatus = null;
    if (shareViaWhatsApp && shareViaEmail) {
      sharedStatus = "both";
    } else if (shareViaWhatsApp) {
      sharedStatus = "whatsapp";
    } else if (shareViaEmail) {
      sharedStatus = "email";
    }

    const followupResult = await queryWithRetry(
      `INSERT INTO Followups (employee_id, clientID, contactPersonID, status, remarks, nextFollowupDate, shared, Following) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employee_id,
        clientID,
        contactID || null,
        status,
        remarks || null,
        nextFollowup || null,
        sharedStatus,
        following || 0
      ]
    );

    const followupId = followupResult.insertId;

    const hasMeetingData =
      meetingData.title?.trim() &&
      meetingData.date &&
      meetingData.startTime &&
      meetingData.endTime;

    if (hasMeetingData) {
      await queryWithRetry(
        `INSERT INTO Marketing_meetings ( followupID, title, date, startTime, endTime, agenda, link, attendees) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          followupId,
          meetingData.title,
          meetingData.date,
          meetingData.startTime,
          meetingData.endTime,
          meetingData.agenda || null,
          meetingData.link || null,
          meetingData.attendees || null,
        ]
      );
    }

    res.status(200).json({
      success: true,
      message: "Followup added successfully",
      followupId: followupId,
    });
  } catch (err) {
    console.error("Error adding followup:", err);
    res.status(500).json({ error: "Failed to add followup" });
  }
});

router.get("/", async (req, res) => {
  try {
    const { status, employee_id } = req.query;

    if (!status) {
      return res.status(400).json({ error: "Status query is required" });
    }

    let followingCondition = "AND f.Following = 0";
    let statusCondition = "";

    if (status === "returned") {
      followingCondition = "AND f.Following = 1";
      statusCondition = "f.status != 'converted' AND f.status != 'droped'";
    } else if (status === "returnedConverted") {
      followingCondition = "AND f.Following = 1";
      statusCondition = "f.status = 'converted'";
    } else if (status === "returnedDroped") {
      followingCondition = "AND f.Following = 1";
      statusCondition = "f.status = 'droped'";
    } else if (status === "first_followup") {
      statusCondition = "f.status IN ('first_followup', 'not_reachable')";
    } else if (status === "converted") {
      statusCondition = "f.status = 'converted'";
    } else {
      statusCondition = "f.status = ?";
    }

    const latestStatusQuery = `
      SELECT f.*, 
        c.id as clientID, 
        c.company_name, 
        c.customer_name, 
        c.industry_type, 
        c.website, 
        c.address, 
        c.city, 
        c.state, 
        c.reference, 
        c.requirements, 
        c.created_at AS client_created_at, 
        c.updated_at AS client_updated_at,
        e.employee_name AS employee_name
      FROM Followups f
      JOIN (
        SELECT clientID, MAX(created_at) AS last_date
        FROM Followups
        ${employee_id ? "WHERE employee_id = ?" : ""}
        GROUP BY clientID
      ) lf ON f.clientID = lf.clientID AND f.created_at = lf.last_date
      JOIN ClientsData c ON f.clientID = c.id
      LEFT JOIN employees_details e ON c.employee_id = e.employee_id
      WHERE ${statusCondition}
      AND c.active = 1
      ${followingCondition}
      ${employee_id ? "AND f.employee_id = ?" : ""}
      ORDER BY f.created_at DESC
    `;

    let params = [];
    if (employee_id) {
      params.push(employee_id);
    }
    if (!["first_followup", "converted", "returned", "returnedConverted", "returnedDroped"].includes(status)) {
      params.push(status);
    }
    if (employee_id) {
      params.push(employee_id);
    }

    const latestRows = await queryWithRetry(latestStatusQuery, params);
    const matchedClientIDs = latestRows.map((r) => r.clientID);

    let noFollowupClients = [];
    if (status === "first_followup") {
      const noFollowupQuery = `
        SELECT c.id AS clientID, 
          c.company_name, 
          c.customer_name, 
          c.industry_type, 
          c.website, 
          c.address, 
          c.city, 
          c.state, 
          c.reference, 
          c.requirements, 
          c.created_at AS client_created_at, 
          c.updated_at AS client_updated_at,
          e.employee_name AS employee_name
        FROM ClientsData c
        LEFT JOIN Followups f ON c.id = f.clientID
        LEFT JOIN employees_details e ON c.employee_id = e.employee_id
        WHERE f.clientID IS NULL 
        AND c.active = 1
        ${employee_id ? "AND c.employee_id = ?" : ""}
        ORDER BY c.created_at DESC
      `;

      noFollowupClients = employee_id
        ? await queryWithRetry(noFollowupQuery, [employee_id])
        : await queryWithRetry(noFollowupQuery);
    }

    const clientIDs = [
      ...matchedClientIDs,
      ...noFollowupClients.map((n) => n.clientID),
    ];

    if (clientIDs.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        message: "No clients match the given status",
      });
    }

    const placeholders = clientIDs.map(() => "?").join(",");

    const contactQuery = `
      SELECT * FROM ContactPersons 
      WHERE clientID IN (${placeholders})
      ORDER BY id ASC
    `;
    const contactPersons = await queryWithRetry(contactQuery, clientIDs);

    const contactsGrouped = {};
    contactPersons.forEach((cp) => {
      if (!contactsGrouped[cp.clientID]) contactsGrouped[cp.clientID] = [];
      contactsGrouped[cp.clientID].push(cp);
    });

    const historyQuery = `
      SELECT f.*, 
        cp.name AS contact_person_name, 
        cp.contactNumber, 
        cp.email, 
        cp.designation
      FROM Followups f
      LEFT JOIN ContactPersons cp ON f.contactPersonID = cp.id
      WHERE f.clientID IN (${placeholders})
      ORDER BY f.clientID, f.created_at DESC
    `;
    const history = await queryWithRetry(historyQuery, clientIDs);

    const meetingQuery = `
      SELECT m.*, 
        cp.name AS contact_person_name, 
        f.status AS followup_status
      FROM Marketing_meetings m
      LEFT JOIN Followups f ON m.followupID = f.id
      LEFT JOIN ContactPersons cp ON f.contactPersonID = cp.id
      WHERE m.clientID IN (${placeholders})
      ORDER BY m.date DESC, m.startTime DESC
    `;
    const meetings = await queryWithRetry(meetingQuery, clientIDs);

    const meetingsGrouped = {};
    meetings.forEach((m) => {
      if (!meetingsGrouped[m.clientID]) meetingsGrouped[m.clientID] = [];
      meetingsGrouped[m.clientID].push(m);
    });

    const response = clientIDs.map((id) => {
      const latestFollow = latestRows.find((l) => l.clientID === id);
      const noFollow = noFollowupClients.find((n) => n.clientID === id);
      const clientData = latestFollow || noFollow;

      return {
        clientID: id,
        client_details: {
          id,
          company_name: clientData.company_name,
          customer_name: clientData.customer_name,
          industry_type: clientData.industry_type,
          website: clientData.website,
          address: clientData.address,
          city: clientData.city,
          state: clientData.state,
          reference: clientData.reference,
          requirements: clientData.requirements,
          created_at: latestFollow?.created_at || clientData.client_created_at,
          updated_at: clientData.client_updated_at,
          contactPersons: contactsGrouped[id] || [],
          nextFollowupDate: latestFollow ? latestFollow.nextFollowupDate : "",
          status: latestFollow ? latestFollow.status : "none",
          employee_name: clientData.employee_name || null,
          following: latestFollow?.Following || 0 
        },
        latest_status: latestFollow
          ? {
              id: latestFollow.id,
              status: latestFollow.status,
              remarks: latestFollow.remarks,
              created_at: latestFollow.created_at,
              followup_date: latestFollow.followup_date,
              employee_name: latestFollow.employee_name || null,
            }
          : null,
        history: history.filter((h) => h.clientID === id),
        meetings: meetingsGrouped[id] || [],
      };
    });

    res.status(200).json({ success: true, data: response });
  } catch (error) {
    console.error("Error fetching followup data:", error);
    res.status(500).json({ error: "Failed to fetch followups" });
  }
});

router.get("/client/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;

    const results = await queryWithRetry(
      `SELECT f.*, 
        cp.name as contact_person_name, 
        cp.contactNumber, 
        cp.email, 
        cp.designation
      FROM Followups f
      LEFT JOIN ContactPersons cp ON f.contactPersonID = cp.id
      WHERE f.clientID = ?
      ORDER BY f.created_at DESC`,
      [clientId]
    );

    res.status(200).json({ success: true, data: results });
  } catch (err) {
    console.error("Error fetching client followups:", err);
    res.status(500).json({ error: "Failed to fetch followups" });
  }
});

router.get("/counts", async (req, res) => {
  try {
    const { employee_id } = req.query;

    // Build conditional filters and parameters
    const employeeFilter = employee_id ? "WHERE employee_id = ?" : "";
    const employeeParams = employee_id ? [employee_id] : [];
    const doubleEmployeeParams = employee_id ? [employee_id, employee_id] : [];

    const followupCountsQuery = `
      SELECT 
        CASE 
          WHEN f.status IN ('first_followup', 'not_reachable') THEN 'first_followup'
          ELSE f.status
        END as status_group,
        COUNT(DISTINCT f.clientID) as count
      FROM Followups f
      JOIN (
        SELECT clientID, MAX(created_at) AS last_date
        FROM Followups
        ${employeeFilter}
        GROUP BY clientID
      ) lf ON f.clientID = lf.clientID AND f.created_at = lf.last_date
      JOIN ClientsData c ON f.clientID = c.id
      WHERE c.active = 1 
      ${employee_id ? 'AND f.employee_id = ?' : ''}
      AND f.Following = 0
      GROUP BY status_group
    `;

    const followupCounts = await queryWithRetry(
      followupCountsQuery,
      doubleEmployeeParams
    );

    const noFollowupQuery = `
      SELECT COUNT(*) as count
      FROM ClientsData c
      LEFT JOIN Followups f ON c.id = f.clientID
      WHERE f.clientID IS NULL 
      AND c.active = 1
      ${employee_id ? 'AND c.employee_id = ?' : ''}
    `;

    const noFollowupResult = await queryWithRetry(noFollowupQuery, employeeParams);
    const noFollowupCount = noFollowupResult[0]?.count || 0;

    const currentClientsQuery = `
      SELECT COUNT(*) as count
      FROM ClientsData
      WHERE active = 1 ${employee_id ? 'AND employee_id = ?' : ''}
    `;

    const currentClientsResult = await queryWithRetry(currentClientsQuery, employeeParams);

    const deletedClientsQuery = `
      SELECT COUNT(*) as count
      FROM ClientsData
      WHERE active = 0 ${employee_id ? 'AND employee_id = ?' : ''}
    `;

    const deletedClientsResult = await queryWithRetry(deletedClientsQuery, employeeParams);

    const convertedQuery = `
      SELECT COUNT(DISTINCT f.clientID) as count
      FROM Followups f
      JOIN (
        SELECT clientID, MAX(created_at) AS last_date
        FROM Followups
        ${employeeFilter}
        GROUP BY clientID
      ) lf ON f.clientID = lf.clientID AND f.created_at = lf.last_date
      JOIN ClientsData c ON f.clientID = c.id
      WHERE f.status = 'converted'
      AND c.active = 1
      ${employee_id ? 'AND f.employee_id = ?' : ''}
      AND f.Following = 0
    `;

    const convertedResult = await queryWithRetry(convertedQuery, doubleEmployeeParams);

    const returnedQuery = `
      SELECT COUNT(DISTINCT f.clientID) as count
      FROM Followups f
      JOIN (
        SELECT clientID, MAX(created_at) AS last_date
        FROM Followups
        ${employeeFilter}
        GROUP BY clientID
      ) lf ON f.clientID = lf.clientID AND f.created_at = lf.last_date
      JOIN ClientsData c ON f.clientID = c.id
      WHERE f.status != 'converted'
      AND f.status != 'droped'
      AND c.active = 1
      ${employee_id ? 'AND f.employee_id = ?' : ''}
      AND f.Following = 1
    `;

    const returnedResult = await queryWithRetry(returnedQuery, doubleEmployeeParams);

    const returnedConvertedQuery = `
      SELECT COUNT(DISTINCT f.clientID) as count
      FROM Followups f
      JOIN (
        SELECT clientID, MAX(created_at) AS last_date
        FROM Followups
        ${employeeFilter}
        GROUP BY clientID
      ) lf ON f.clientID = lf.clientID AND f.created_at = lf.last_date
      JOIN ClientsData c ON f.clientID = c.id
      WHERE f.status = 'converted'
      AND c.active = 1
      ${employee_id ? 'AND f.employee_id = ?' : ''}
      AND f.Following = 1
    `;

    const returnedConvertedResult = await queryWithRetry(returnedConvertedQuery, doubleEmployeeParams);

    const returnedDropedQuery = `
      SELECT COUNT(DISTINCT f.clientID) as count
      FROM Followups f
      JOIN (
        SELECT clientID, MAX(created_at) AS last_date
        FROM Followups
        ${employeeFilter}
        GROUP BY clientID
      ) lf ON f.clientID = lf.clientID AND f.created_at = lf.last_date
      JOIN ClientsData c ON f.clientID = c.id
      WHERE f.status = 'droped'
      AND c.active = 1
      ${employee_id ? 'AND f.employee_id = ?' : ''}
      AND f.Following = 1
    `;

    const returnedDropedResult = await queryWithRetry(returnedDropedQuery, doubleEmployeeParams);

    const counts = {
      first_followup: noFollowupCount,
      second_followup: 0,
      not_available: 0,
      not_interested: 0,
      not_reachable: 0,
      droped: 0,
      converted: convertedResult[0]?.count || 0,
      returned: returnedResult[0]?.count || 0,
      returnedConverted: returnedConvertedResult[0]?.count || 0,
      returnedDroped: returnedDropedResult[0]?.count || 0,
      current: currentClientsResult[0]?.count || 0,
      deleted: deletedClientsResult[0]?.count || 0,
    };

    followupCounts.forEach((row) => {
      if (row.status_group === "first_followup") {
        counts.first_followup += row.count;
      } else if (counts.hasOwnProperty(row.status_group)) {
        counts[row.status_group] = row.count;
      }
    });

    const notReachableQuery = `
      SELECT COUNT(DISTINCT f.clientID) as count
      FROM Followups f
      JOIN (
        SELECT clientID, MAX(created_at) AS last_date
        FROM Followups
        ${employeeFilter}
        GROUP BY clientID
      ) lf ON f.clientID = lf.clientID AND f.created_at = lf.last_date
      JOIN ClientsData c ON f.clientID = c.id
      WHERE f.status = 'not_reachable'
      AND c.active = 1
      ${employee_id ? 'AND f.employee_id = ?' : ''}
      AND f.Following = 0
    `;

    const notReachableResult = await queryWithRetry(notReachableQuery, doubleEmployeeParams);
    counts.not_reachable = notReachableResult[0]?.count || 0;

    res.status(200).json({ success: true, data: counts });
  } catch (error) {
    console.error("Error fetching followup counts:", error);
    res.status(500).json({ error: "Failed to fetch counts" });
  }
});

module.exports = router;