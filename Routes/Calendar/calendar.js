const express = require("express");
const router = express.Router();
const { queryWithRetry } = require("../../dataBase/connection");

// ✅ GET - All employees list for attendee selection
router.get("/employees", async (req, res) => {
  try {
    const query = `
      SELECT 
        employee_id,
        employee_name,
        designation,
        email_official
      FROM employees_details
      WHERE working_status = 'Active'
      ORDER BY employee_name ASC
    `;

    const employees = await queryWithRetry(query);

    res.json({
      status: true,
      count: employees.length,
      data: employees,
    });
  } catch (error) {
    console.error("Get employees error:", error);
    res.status(500).json({
      status: false,
      message: "Error fetching employees",
      error: error.message,
    });
  }
});

// ✅ Health check
router.get("/health", (req, res) => {
  res.json({
    status: true,
    message: "Calendar service is running",
    timestamp: new Date().toISOString(),
  });
});

// ✅ GET - All events with attendee details
router.get("/", async (req, res) => {
  try {
    const query = `
      SELECT 
        ce.*,
        creator.employee_name as creator_name
      FROM calendar_events ce
      LEFT JOIN employees_details creator ON ce.employee_id = creator.employee_id
      ORDER BY ce.date ASC, ce.start_time ASC
    `;

    const events = await queryWithRetry(query);

    const formattedEvents = await Promise.all(
      events.map(async (event) => {
        const attendeeIds = JSON.parse(event.attendees || "[]");
        
        if (attendeeIds.length > 0) {
          const placeholders = attendeeIds.map(() => "?").join(",");
          const attendeeQuery = `
            SELECT employee_id, employee_name 
            FROM employees_details 
            WHERE employee_id IN (${placeholders})
          `;
          const attendeeDetails = await queryWithRetry(attendeeQuery, attendeeIds);
          
          return {
            ...event,
            attendees: attendeeDetails,
          };
        }
        
        return {
          ...event,
          attendees: [],
        };
      })
    );

    res.json(formattedEvents);
  } catch (error) {
    console.error("Get all events error:", error);
    res.status(500).json({
      status: false,
      message: "Error fetching events",
      error: error.message,
    });
  }
});

// ✅ GET - Events by date range
router.get("/range", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        status: false,
        message: "startDate and endDate query parameters are required",
      });
    }

    const query = `
      SELECT 
        ce.*,
        creator.employee_name as creator_name
      FROM calendar_events ce
      LEFT JOIN employees_details creator ON ce.employee_id = creator.employee_id
      WHERE (
        (ce.date BETWEEN ? AND ?) OR
        (ce.end_date BETWEEN ? AND ?) OR
        (ce.date <= ? AND ce.end_date >= ?)
      )
      ORDER BY ce.date ASC, ce.start_time ASC
    `;

    const events = await queryWithRetry(query, [
      startDate,
      endDate,
      startDate,
      endDate,
      startDate,
      endDate,
    ]);

    const formattedEvents = await Promise.all(
      events.map(async (event) => {
        const attendeeIds = JSON.parse(event.attendees || "[]");
        
        if (attendeeIds.length > 0) {
          const placeholders = attendeeIds.map(() => "?").join(",");
          const attendeeQuery = `
            SELECT employee_id, employee_name 
            FROM employees_details 
            WHERE employee_id IN (${placeholders})
          `;
          const attendeeDetails = await queryWithRetry(attendeeQuery, attendeeIds);
          
          return {
            ...event,
            attendees: attendeeDetails,
          };
        }
        
        return {
          ...event,
          attendees: [],
        };
      })
    );

    res.json(formattedEvents);
  } catch (error) {
    console.error("Get events by range error:", error);
    res.status(500).json({
      status: false,
      message: "Error fetching events by date range",
      error: error.message,
    });
  }
});

// ✅ GET - Events by specific date
router.get("/date/:date", async (req, res) => {
  try {
    const { date } = req.params;

    const query = `
      SELECT 
        ce.*,
        creator.employee_name as creator_name
      FROM calendar_events ce
      LEFT JOIN employees_details creator ON ce.employee_id = creator.employee_id
      WHERE ce.date = ? OR (ce.date <= ? AND ce.end_date >= ?)
      ORDER BY ce.start_time ASC
    `;

    const events = await queryWithRetry(query, [date, date, date]);

    const formattedEvents = await Promise.all(
      events.map(async (event) => {
        const attendeeIds = JSON.parse(event.attendees || "[]");
        
        if (attendeeIds.length > 0) {
          const placeholders = attendeeIds.map(() => "?").join(",");
          const attendeeQuery = `
            SELECT employee_id, employee_name 
            FROM employees_details 
            WHERE employee_id IN (${placeholders})
          `;
          const attendeeDetails = await queryWithRetry(attendeeQuery, attendeeIds);
          
          return {
            ...event,
            attendees: attendeeDetails,
          };
        }
        
        return {
          ...event,
          attendees: [],
        };
      })
    );

    res.json(formattedEvents);
  } catch (error) {
    console.error("Get events by date error:", error);
    res.status(500).json({
      status: false,
      message: "Error fetching events for date",
      error: error.message,
    });
  }
});

// ✅ GET - Events by employee ID (creator or attendee)
router.get("/employee/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;

    const query = `
      SELECT 
        ce.*,
        creator.employee_name as creator_name
      FROM calendar_events ce
      LEFT JOIN employees_details creator ON ce.employee_id = creator.employee_id
      WHERE ce.employee_id = ? 
         OR JSON_CONTAINS(ce.attendees, JSON_QUOTE(?), '$')
      ORDER BY ce.date ASC, ce.start_time ASC
    `;

    const events = await queryWithRetry(query, [employeeId, employeeId]);

    const formattedEvents = await Promise.all(
      events.map(async (event) => {
        const attendeeIds = JSON.parse(event.attendees || "[]");
        
        if (attendeeIds.length > 0) {
          const placeholders = attendeeIds.map(() => "?").join(",");
          const attendeeQuery = `
            SELECT employee_id, employee_name 
            FROM employees_details 
            WHERE employee_id IN (${placeholders})
          `;
          const attendeeDetails = await queryWithRetry(attendeeQuery, attendeeIds);
          
          return {
            ...event,
            attendees: attendeeDetails,
          };
        }
        
        return {
          ...event,
          attendees: [],
        };
      })
    );

    res.json(formattedEvents);
  } catch (error) {
    console.error("Get events by employee error:", error);
    res.status(500).json({
      status: false,
      message: "Error fetching events for employee",
      error: error.message,
    });
  }
});

// ✅ GET - Events by event type
router.get("/type/:eventtype", async (req, res) => {
  try {
    const { eventtype } = req.params;

    const query = `
      SELECT 
        ce.*,
        creator.employee_name as creator_name
      FROM calendar_events ce
      LEFT JOIN employees_details creator ON ce.employee_id = creator.employee_id
      WHERE ce.event_type = ?
      ORDER BY ce.date ASC, ce.start_time ASC
    `;

    const events = await queryWithRetry(query, [eventtype]);

    const formattedEvents = await Promise.all(
      events.map(async (event) => {
        const attendeeIds = JSON.parse(event.attendees || "[]");
        
        if (attendeeIds.length > 0) {
          const placeholders = attendeeIds.map(() => "?").join(",");
          const attendeeQuery = `
            SELECT employee_id, employee_name 
            FROM employees_details 
            WHERE employee_id IN (${placeholders})
          `;
          const attendeeDetails = await queryWithRetry(attendeeQuery, attendeeIds);
          
          return {
            ...event,
            attendees: attendeeDetails,
          };
        }
        
        return {
          ...event,
          attendees: [],
        };
      })
    );

    res.json(formattedEvents);
  } catch (error) {
    console.error("Get events by type error:", error);
    res.status(500).json({
      status: false,
      message: "Error fetching events by type",
      error: error.message,
    });
  }
});

// ✅ POST - Create new event
router.post("/", async (req, res) => {
  console.log("POST /api/calendar called");
  
  try {
    const {
      title,
      eventtype,
      startTime,
      endTime,
      date,
      endDate,
      agenda,
      link,
      day,
      attendees,
      formType,
      employeeID,
    } = req.body;

    if (!title || !eventtype || !date || !formType || !employeeID) {
      return res.status(400).json({
        status: false,
        message: "title, eventtype, date, formType and employeeID are required",
      });
    }

    const checkEmployeeQuery = `
      SELECT employee_id FROM employees_details WHERE employee_id = ?
    `;
    const employeeExists = await queryWithRetry(checkEmployeeQuery, [employeeID]);

    if (employeeExists.length === 0) {
      return res.status(400).json({
        status: false,
        message: "Invalid employee_id (creator)",
      });
    }

    let validatedAttendees = [];
    if (attendees && attendees.length > 0) {
      const placeholders = attendees.map(() => "?").join(",");
      const validateQuery = `
        SELECT employee_id FROM employees_details 
        WHERE employee_id IN (${placeholders})
      `;
      const validEmployees = await queryWithRetry(validateQuery, attendees);

      if (validEmployees.length !== attendees.length) {
        return res.status(400).json({
          status: false,
          message: "One or more invalid employee IDs in attendees list",
        });
      }
      validatedAttendees = attendees;
    }

    const insertEventQuery = `
      INSERT INTO calendar_events 
      (employee_id, title, event_type, start_time, end_time, date, end_date, 
       agenda, link, day, form_type, attendees)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const result = await queryWithRetry(insertEventQuery, [
      employeeID,
      title,
      eventtype,
      startTime || "",
      endTime || "",
      date,
      endDate || date,
      agenda || "",
      link || "",
      day || "workingday",
      formType,
      JSON.stringify(validatedAttendees),
    ]);

    const eventId = result.insertId;

    const getEventQuery = `
      SELECT 
        ce.*,
        creator.employee_name as creator_name
      FROM calendar_events ce
      LEFT JOIN employees_details creator ON ce.employee_id = creator.employee_id
      WHERE ce.id = ?
    `;

    const createdEvents = await queryWithRetry(getEventQuery, [eventId]);
    const createdEvent = createdEvents[0];

    let attendeeDetails = [];
    if (validatedAttendees.length > 0) {
      const placeholders = validatedAttendees.map(() => "?").join(",");
      const attendeeQuery = `
        SELECT employee_id, employee_name 
        FROM employees_details 
        WHERE employee_id IN (${placeholders})
      `;
      attendeeDetails = await queryWithRetry(attendeeQuery, validatedAttendees);
    }

    const responseEvent = {
      ...createdEvent,
      attendees: attendeeDetails,
    };

    if (req.io) {
      req.io.to("calendar_room").emit("calendar_event_created", {
        status: true,
        data: responseEvent,
      });
    }

    console.log("Event created with ID:", eventId);
    res.status(201).json({
      status: true,
      message: "Event created successfully",
      id: eventId,
      data: responseEvent,
    });
  } catch (error) {
    console.error("Create event error:", error);
    res.status(500).json({
      status: false,
      message: "Error creating event",
      error: error.message,
    });
  }
});

// ✅ PUT - Update event
router.put("/:id", async (req, res) => {
  console.log(`PUT /api/calendar/${req.params.id} called`);
  
  try {
    const { id } = req.params;
    const allowedUpdates = [
      "title",
      "eventtype",
      "startTime",
      "endTime",
      "date",
      "endDate",
      "agenda",
      "link",
      "day",
      "attendees",
      "formType",
    ];

    const updateFields = [];
    const updateValues = [];

    for (const field of allowedUpdates) {
      if (req.body[field] !== undefined) {
        if (field === "attendees") {
          if (req.body.attendees.length > 0) {
            const placeholders = req.body.attendees.map(() => "?").join(",");
            const validateQuery = `
              SELECT employee_id FROM employees_details 
              WHERE employee_id IN (${placeholders})
            `;
            const validEmployees = await queryWithRetry(validateQuery, req.body.attendees);

            if (validEmployees.length !== req.body.attendees.length) {
              return res.status(400).json({
                status: false,
                message: "One or more invalid employee IDs in attendees list",
              });
            }
          }
          updateFields.push("attendees = ?");
          updateValues.push(JSON.stringify(req.body.attendees));
        } else {
          const dbField =
            field === "eventtype" ? "event_type" :
            field === "startTime" ? "start_time" :
            field === "endTime" ? "end_time" :
            field === "endDate" ? "end_date" :
            field === "formType" ? "form_type" : field;
          
          updateFields.push(`${dbField} = ?`);
          updateValues.push(req.body[field]);
        }
      }
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        status: false,
        message: "No fields to update",
      });
    }

    const updateQuery = `
      UPDATE calendar_events 
      SET ${updateFields.join(", ")}
      WHERE id = ?
    `;
    updateValues.push(id);
    await queryWithRetry(updateQuery, updateValues);

    const getEventQuery = `
      SELECT 
        ce.*,
        creator.employee_name as creator_name
      FROM calendar_events ce
      LEFT JOIN employees_details creator ON ce.employee_id = creator.employee_id
      WHERE ce.id = ?
    `;

    const events = await queryWithRetry(getEventQuery, [id]);

    if (events.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Event not found",
      });
    }

    const updatedEvent = events[0];
    const attendeeIds = JSON.parse(updatedEvent.attendees || "[]");

    let attendeeDetails = [];
    if (attendeeIds.length > 0) {
      const placeholders = attendeeIds.map(() => "?").join(",");
      const attendeeQuery = `
        SELECT employee_id, employee_name 
        FROM employees_details 
        WHERE employee_id IN (${placeholders})
      `;
      attendeeDetails = await queryWithRetry(attendeeQuery, attendeeIds);
    }

    const responseEvent = {
      ...updatedEvent,
      attendees: attendeeDetails,
    };

    if (req.io) {
      req.io.to("calendar_room").emit("calendar_event_updated", {
        status: true,
        data: responseEvent,
      });
    }

    res.json({
      status: true,
      message: "Event updated successfully",
      data: responseEvent,
    });
  } catch (error) {
    console.error("Update event error:", error);
    res.status(500).json({
      status: false,
      message: "Error updating event",
      error: error.message,
    });
  }
});

// ✅ DELETE - Delete event
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  console.log("Deleting calendar event:", id);
  
  try {
    const getEventQuery = `
      SELECT 
        ce.*,
        creator.employee_name as creator_name
      FROM calendar_events ce
      LEFT JOIN employees_details creator ON ce.employee_id = creator.employee_id
      WHERE ce.id = ?
    `;

    const events = await queryWithRetry(getEventQuery, [id]);

    if (events.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Event not found",
      });
    }

    const event = events[0];
    const attendeeIds = JSON.parse(event.attendees || "[]");

    let attendeeDetails = [];
    if (attendeeIds.length > 0) {
      const placeholders = attendeeIds.map(() => "?").join(",");
      const attendeeQuery = `
        SELECT employee_id, employee_name 
        FROM employees_details 
        WHERE employee_id IN (${placeholders})
      `;
      attendeeDetails = await queryWithRetry(attendeeQuery, attendeeIds);
    }

    const responseEvent = {
      ...event,
      attendees: attendeeDetails,
    };

    await queryWithRetry("DELETE FROM calendar_events WHERE id = ?", [id]);

    if (req.io) {
      req.io.to("calendar_room").emit("calendar_event_deleted", {
        status: true,
        eventId: id,
        empID: event.employee_id,
        title: event.title,
      });
    }

    res.json({
      status: true,
      message: "Event deleted successfully",
      data: responseEvent,
    });
  } catch (error) {
    console.error("Delete event error:", error);
    res.status(500).json({
      status: false,
      message: "Error deleting event",
      error: error.message,
    });
  }
});

// ✅ GET - Single event by ID (MUST be last)
router.get("/:id", async (req, res) => {
  try {
    const query = `
      SELECT 
        ce.*,
        creator.employee_name as creator_name
      FROM calendar_events ce
      LEFT JOIN employees_details creator ON ce.employee_id = creator.employee_id
      WHERE ce.id = ?
    `;

    const events = await queryWithRetry(query, [req.params.id]);

    if (events.length === 0) {
      return res.status(404).json({
        status: false,
        message: "Event not found",
      });
    }

    const event = events[0];
    const attendeeIds = JSON.parse(event.attendees || "[]");
    
    let attendeeDetails = [];
    if (attendeeIds.length > 0) {
      const placeholders = attendeeIds.map(() => "?").join(",");
      const attendeeQuery = `
        SELECT employee_id, employee_name 
        FROM employees_details 
        WHERE employee_id IN (${placeholders})
      `;
      attendeeDetails = await queryWithRetry(attendeeQuery, attendeeIds);
    }

    res.json({
      ...event,
      attendees: attendeeDetails,
    });
  } catch (error) {
    console.error("Get event by ID error:", error);
    res.status(500).json({
      status: false,
      message: "Error fetching event",
      error: error.message,
    });
  }
});

module.exports = router;
