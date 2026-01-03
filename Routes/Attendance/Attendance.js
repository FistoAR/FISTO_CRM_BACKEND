const express = require("express");
const router = express.Router();
const { getConnectionWithRetry } = require("../../dataBase/connection");

// Helper to convert 12h time string to MySQL TIME format
const parseTimeString = (timeStr) => {
  const [time, ampm] = timeStr.split(' ');
  let [hours, minutes, seconds] = time.split(':').map(Number);
  if (ampm === 'PM' && hours !== 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

// ✅ Format duration in human-readable format
const formatDuration = (morningIn, morningOut, afternoonIn, afternoonOut) => {
  let totalSeconds = 0;
  
  // Calculate total seconds
  if (morningIn && morningOut) {
    const [h1, m1, s1] = morningIn.split(':').map(Number);
    const [h2, m2, s2] = morningOut.split(':').map(Number);
    totalSeconds += (h2 * 3600 + m2 * 60 + s2) - (h1 * 3600 + m1 * 60 + s1);
  }
  
  if (afternoonIn && afternoonOut) {
    const [h1, m1, s1] = afternoonIn.split(':').map(Number);
    const [h2, m2, s2] = afternoonOut.split(':').map(Number);
    totalSeconds += (h2 * 3600 + m2 * 60 + s2) - (h1 * 3600 + m1 * 60 + s1);
  }
  
  // Handle zero or negative time
  if (totalSeconds <= 0) {
    return '0 seconds';
  }
  
  // Convert to hours, minutes, seconds
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  // Smart formatting
  if (hours >= 1) {
    if (minutes > 0) {
      return `${hours} hour${hours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
    } else {
      return `${hours} hour${hours !== 1 ? 's' : ''}`;
    }
  } else if (minutes >= 1) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  } else {
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  }
};

// ✅ Determine status based on completion
const calculateStatus = (morningIn, morningOut, afternoonIn, afternoonOut) => {
  const allComplete = morningIn && morningOut && afternoonIn && afternoonOut;
  const anyPresent = morningIn || morningOut || afternoonIn || afternoonOut;
  
  if (allComplete) return 'COMPLETE';
  if (anyPresent) return 'PARTIAL';
  return 'INCOMPLETE';
};

// GET - Fetch attendance
router.get("/", async (req, res) => {
  let connection;
  try {
    const { employee_id, date } = req.query;
    
    if (!employee_id || !date) {
      return res.status(400).json({ status: false, message: "Missing employee_id or date" });
    }
    
    connection = await getConnectionWithRetry();
    
    const [rows] = await new Promise((resolve, reject) => {
      connection.query(
        `SELECT * FROM attendance WHERE employee_id = ? AND login_date = ?`,
        [employee_id, date],
        (err, results) => err ? reject(err) : resolve([results])
      );
    });
    
    res.json({
      status: true,
      data: rows[0] || null
    });
  } catch (error) {
    console.error("GET attendance error:", error);
    res.status(500).json({ status: false, message: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// ✅ POST - Record attendance with TIME FROM FRONTEND
router.post("/", async (req, res) => {
  let connection;
  try {
    const { employee_id, employee_name, login_date, action, time } = req.body;
    
    if (!employee_id || !employee_name || !login_date || !action) {
      return res.status(400).json({ status: false, message: "Missing required fields" });
    }
    
    if (!time) {
      return res.status(400).json({ status: false, message: "Time is required from frontend" });
    }
    
    const validActions = ['morning_in', 'morning_out', 'afternoon_in', 'afternoon_out'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ status: false, message: "Invalid action" });
    }
    
    // ✅ USE TIME FROM FRONTEND (already synced with PHP server)
    const timeValue = parseTimeString(time);
    
    connection = await getConnectionWithRetry();
    
    // Check if record exists
    const [existing] = await new Promise((resolve, reject) => {
      connection.query(
        `SELECT * FROM attendance WHERE employee_id = ? AND login_date = ?`,
        [employee_id, login_date],
        (err, results) => err ? reject(err) : resolve([results])
      );
    });
    
    // Update or Insert with time from frontend
    if (existing.length > 0) {
      await new Promise((resolve, reject) => {
        connection.query(
          `UPDATE attendance SET ${action} = ? WHERE employee_id = ? AND login_date = ?`,
          [timeValue, employee_id, login_date],
          (err) => err ? reject(err) : resolve()
        );
      });
      
      console.log(`Updated ${action} for ${employee_id} on ${login_date} with time ${time}`);
    } else {
      await new Promise((resolve, reject) => {
        connection.query(
          `INSERT INTO attendance (employee_id, employee_name, login_date, ${action}) VALUES (?, ?, ?, ?)`,
          [employee_id, employee_name, login_date, timeValue],
          (err) => err ? reject(err) : resolve()
        );
      });
      
      console.log(`Inserted new record with ${action} for ${employee_id} on ${login_date} with time ${time}`);
    }
    
    // Fetch the record to calculate total_hours
    const [currentRecord] = await new Promise((resolve, reject) => {
      connection.query(
        `SELECT morning_in, morning_out, afternoon_in, afternoon_out FROM attendance WHERE employee_id = ? AND login_date = ?`,
        [employee_id, login_date],
        (err, results) => err ? reject(err) : resolve([results])
      );
    });
    
    if (!currentRecord[0]) {
      throw new Error('Record not found after insert/update');
    }
    
    const record = currentRecord[0];
    
    // Calculate total_hours (formatted string)
    const totalHours = formatDuration(
      record.morning_in,
      record.morning_out,
      record.afternoon_in,
      record.afternoon_out
    );
    
    // Calculate status
    const status = calculateStatus(
      record.morning_in,
      record.morning_out,
      record.afternoon_in,
      record.afternoon_out
    );
    
    console.log(`Calculated total_hours: ${totalHours}, status: ${status}`);
    
    // Update with calculated values
    await new Promise((resolve, reject) => {
      connection.query(
        `UPDATE attendance SET total_hours = ?, status = ? WHERE employee_id = ? AND login_date = ?`,
        [totalHours, status, employee_id, login_date],
        (err) => {
          if (err) {
            console.error('Error updating total_hours:', err);
            reject(err);
          } else {
            console.log(`Successfully updated total_hours to: ${totalHours}`);
            resolve();
          }
        }
      );
    });
    
    // Fetch final record to return
    const [finalRecord] = await new Promise((resolve, reject) => {
      connection.query(
        `SELECT * FROM attendance WHERE employee_id = ? AND login_date = ?`,
        [employee_id, login_date],
        (err, results) => err ? reject(err) : resolve([results])
      );
    });
    
    console.log('Final record:', finalRecord[0]);
    
    res.json({
      status: true,
      message: `${action.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} recorded at ${time}`,
      recordedTime: time,
      data: finalRecord[0]
    });
    
  } catch (error) {
    console.error("POST attendance error:", error);
    res.status(500).json({ status: false, message: error.message });
  } finally {
    if (connection) connection.release();
  }
});

// ✅ Recalculate all existing records
router.post("/recalculate-all", async (req, res) => {
  let connection;
  try {
    connection = await getConnectionWithRetry();
    
    const [records] = await new Promise((resolve, reject) => {
      connection.query(
        `SELECT * FROM attendance`,
        (err, results) => err ? reject(err) : resolve([results])
      );
    });
    
    let count = 0;
    let errors = 0;
    
    for (const record of records) {
      try {
        const totalHours = formatDuration(
          record.morning_in,
          record.morning_out,
          record.afternoon_in,
          record.afternoon_out
        );
        
        const status = calculateStatus(
          record.morning_in,
          record.morning_out,
          record.afternoon_in,
          record.afternoon_out
        );
        
        await new Promise((resolve, reject) => {
          connection.query(
            `UPDATE attendance SET total_hours = ?, status = ? WHERE id = ?`,
            [totalHours, status, record.id],
            (err) => err ? reject(err) : resolve()
          );
        });
        
        count++;
        console.log(`Recalculated record ${record.id}: ${totalHours}`);
      } catch (err) {
        errors++;
        console.error(`Error recalculating record ${record.id}:`, err);
      }
    }
    
    res.json({
      status: true,
      message: `Successfully recalculated ${count} attendance records${errors > 0 ? `, ${errors} errors` : ''}`,
      count: count,
      errors: errors
    });
  } catch (error) {
    console.error("Recalculate error:", error);
    res.status(500).json({ status: false, message: error.message });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;