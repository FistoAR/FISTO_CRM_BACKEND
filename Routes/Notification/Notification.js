console.log("🚀 LOADING Notification route...");

const express = require("express");
const router = express.Router();
const { queryWithRetry } = require("../../dataBase/connection");

// ========== GET USER NOTIFICATIONS ==========
router.get("/:employeeId", async (req, res) => {
  console.log("✅ GET NOTIFICATIONS HIT!");
  try {
    const { employeeId } = req.params;

    const query = `
      SELECT 
        notification_id,
        notification_data,
        is_read,
        created_at
      FROM user_notifications
      WHERE employee_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `;

    const results = await queryWithRetry(query, [employeeId]);

    const formattedResults = results.map((row) => {
      const data = typeof row.notification_data === 'string' 
        ? JSON.parse(row.notification_data) 
        : row.notification_data;
      
      return {
        ...data,
        id: row.notification_id,
        read: row.is_read === 1,
      };
    });

    console.log(`✅ Found ${formattedResults.length} notifications for ${employeeId}`);
    res.json({ success: true, notifications: formattedResults });
  } catch (err) {
    console.error("Get notifications error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch notifications",
      details: err.message 
    });
  }
});

// ========== SAVE NEW NOTIFICATION ==========
router.post("/", async (req, res) => {
  console.log("✅ SAVE NOTIFICATION HIT!");
  try {
    const { employeeId, notification } = req.body;

    if (!employeeId || !notification) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing required fields: employeeId or notification" 
      });
    }

    const query = `
      INSERT INTO user_notifications 
      (employee_id, notification_id, notification_data, is_read, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      notification_data = VALUES(notification_data),
      is_read = VALUES(is_read)
    `;

    await queryWithRetry(query, [
      employeeId,
      notification.id,
      JSON.stringify(notification),
      notification.read ? 1 : 0,
      notification.timestamp || new Date().toISOString(),
    ]);

    console.log(`✅ Notification saved for ${employeeId}`);
    res.json({ success: true, message: "Notification saved" });
  } catch (err) {
    console.error("Save notification error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to save notification",
      details: err.message 
    });
  }
});

// ========== MARK NOTIFICATION AS READ ==========
router.patch("/:notificationId/read", async (req, res) => {
  console.log("✅ MARK AS READ HIT!");
  try {
    const { notificationId } = req.params;
    const { employeeId } = req.body;

    if (!employeeId) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing employeeId in request body" 
      });
    }

    const query = `
      UPDATE user_notifications 
      SET is_read = TRUE 
      WHERE notification_id = ? AND employee_id = ?
    `;

    const result = await queryWithRetry(query, [notificationId, employeeId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        success: false, 
        error: "Notification not found" 
      });
    }

    console.log(`✅ Notification ${notificationId} marked as read`);
    res.json({ success: true, message: "Notification marked as read" });
  } catch (err) {
    console.error("Mark as read error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to mark as read",
      details: err.message 
    });
  }
});

// ========== CLEAR SINGLE NOTIFICATION (DELETE FROM DB) ==========
router.delete("/:notificationId", async (req, res) => {
  console.log("✅ DELETE NOTIFICATION HIT!");
  try {
    const { notificationId } = req.params;
    const { employeeId } = req.body;

    if (!employeeId) {
      return res.status(400).json({ 
        success: false, 
        error: "Missing employeeId in request body" 
      });
    }

    const query = `
      DELETE FROM user_notifications 
      WHERE notification_id = ? AND employee_id = ?
    `;

    const result = await queryWithRetry(query, [notificationId, employeeId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        success: false, 
        error: "Notification not found" 
      });
    }

    console.log(`✅ Notification ${notificationId} deleted from DB`);
    res.json({ success: true, message: "Notification deleted" });
  } catch (err) {
    console.error("Delete notification error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to delete notification",
      details: err.message 
    });
  }
});

// ========== CLEAR ALL NOTIFICATIONS (DELETE FROM DB) ==========
router.delete("/clear/:employeeId", async (req, res) => {
  console.log("✅ CLEAR ALL NOTIFICATIONS HIT!");
  try {
    const { employeeId } = req.params;

    const query = `
      DELETE FROM user_notifications 
      WHERE employee_id = ?
    `;

    const result = await queryWithRetry(query, [employeeId]);

    console.log(`✅ All notifications cleared from DB for ${employeeId} (${result.affectedRows} deleted)`);
    res.json({ 
      success: true, 
      message: "All notifications cleared",
      deletedCount: result.affectedRows 
    });
  } catch (err) {
    console.error("Clear all notifications error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to clear notifications",
      details: err.message 
    });
  }
});

// ========== GET UNREAD COUNT ==========
router.get("/unread/:employeeId", async (req, res) => {
  console.log("✅ GET UNREAD COUNT HIT!");
  try {
    const { employeeId } = req.params;

    const query = `
      SELECT COUNT(*) as unread_count
      FROM user_notifications
      WHERE employee_id = ? AND is_read = FALSE
    `;

    const results = await queryWithRetry(query, [employeeId]);
    const unreadCount = results[0]?.unread_count || 0;

    console.log(`✅ Unread count for ${employeeId}: ${unreadCount}`);
    res.json({ success: true, unreadCount });
  } catch (err) {
    console.error("Get unread count error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to get unread count",
      details: err.message 
    });
  }
});

// ========== TEST ROUTE ==========
router.get("/test", (req, res) => {
  console.log("✅ NOTIFICATION TEST ROUTE WORKS!");
  res.json({ success: true, message: "Notification route is working!" });
});

module.exports = router;
console.log("✅ Notification Route EXPORTED!");
