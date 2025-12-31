// Routes/StickyNotes/StickyNotes.js
const express = require("express");
const router = express.Router();
const { getConnectionWithRetry } = require("../dataBase/connection");

// Get all notes for an employee
router.get("/:employeeId", async (req, res) => {
  let connection;
  try {
    const { employeeId } = req.params;
    
    connection = await getConnectionWithRetry();
    
    const query = `
      SELECT 
        id,
        employee_id,
        note_id,
        content,
        background_color,
        is_pinned,
        is_minimized,
        position_x,
        position_y,
        created_at,
        updated_at
      FROM sticky_notes 
      WHERE employee_id = ?
      ORDER BY is_pinned DESC, created_at DESC
    `;
    
    const results = await new Promise((resolve, reject) => {
      connection.query(query, [employeeId], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
    
    // Transform database results to frontend format
    const notes = results.map(note => ({
      id: note.note_id,
      content: note.content || '',
      backgroundColor: note.background_color,
      isPinned: Boolean(note.is_pinned),
      isMinimized: Boolean(note.is_minimized),
      position: (note.position_x !== null && note.position_y !== null) 
        ? { x: note.position_x, y: note.position_y }
        : null,
      createdAt: note.created_at,
      updatedAt: note.updated_at,
      dbId: note.id
    }));
    
    res.json({
      success: true,
      notes: notes.length > 0 ? notes : [{
        id: Date.now(),
        content: '',
        backgroundColor: '#fef68a',
        isPinned: false,
        isMinimized: false,
        position: null,
        createdAt: new Date(),
        updatedAt: new Date()
      }]
    });
    
  } catch (error) {
    console.error("Error fetching sticky notes:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch notes",
      error: error.message 
    });
  } finally {
    if (connection) connection.release();
  }
});

// Save/Update multiple notes (bulk operation)
router.post("/:employeeId/bulk", async (req, res) => {
  let connection;
  try {
    const { employeeId } = req.params;
    const { notes } = req.body;
    
    if (!notes || !Array.isArray(notes)) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid notes data" 
      });
    }
    
    connection = await getConnectionWithRetry();
    
    await new Promise((resolve, reject) => {
      connection.beginTransaction((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    // Delete existing notes for this employee
    await new Promise((resolve, reject) => {
      connection.query(
        "DELETE FROM sticky_notes WHERE employee_id = ?",
        [employeeId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    
    // Insert all notes
    if (notes.length > 0) {
      const insertQuery = `
        INSERT INTO sticky_notes (
          employee_id,
          note_id,
          content,
          background_color,
          is_pinned,
          is_minimized,
          position_x,
          position_y
        ) VALUES ?
      `;
      
      const values = notes.map(note => [
        employeeId,
        note.id,
        note.content || '',
        note.backgroundColor || '#fef68a',
        note.isPinned ? 1 : 0,
        note.isMinimized ? 1 : 0,
        note.position?.x || null,
        note.position?.y || null
      ]);
      
      await new Promise((resolve, reject) => {
        connection.query(insertQuery, [values], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    
    await new Promise((resolve, reject) => {
      connection.commit((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    res.json({ 
      success: true, 
      message: "Notes saved successfully",
      count: notes.length
    });
    
  } catch (error) {
    if (connection) {
      await new Promise((resolve) => {
        connection.rollback(() => resolve());
      });
    }
    console.error("Error saving sticky notes:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to save notes",
      error: error.message 
    });
  } finally {
    if (connection) connection.release();
  }
});

// Save/Update single note
router.post("/:employeeId", async (req, res) => {
  let connection;
  try {
    const { employeeId } = req.params;
    const note = req.body;
    
    if (!note || !note.id) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid note data" 
      });
    }
    
    connection = await getConnectionWithRetry();
    
    const query = `
      INSERT INTO sticky_notes (
        employee_id,
        note_id,
        content,
        background_color,
        is_pinned,
        is_minimized,
        position_x,
        position_y
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        content = VALUES(content),
        background_color = VALUES(background_color),
        is_pinned = VALUES(is_pinned),
        is_minimized = VALUES(is_minimized),
        position_x = VALUES(position_x),
        position_y = VALUES(position_y)
    `;
    
    await new Promise((resolve, reject) => {
      connection.query(query, [
        employeeId,
        note.id,
        note.content || '',
        note.backgroundColor || '#fef68a',
        note.isPinned ? 1 : 0,
        note.isMinimized ? 1 : 0,
        note.position?.x || null,
        note.position?.y || null
      ], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    res.json({ 
      success: true, 
      message: "Note saved successfully" 
    });
    
  } catch (error) {
    console.error("Error saving sticky note:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to save note",
      error: error.message 
    });
  } finally {
    if (connection) connection.release();
  }
});

// Delete a note
router.delete("/:employeeId/:noteId", async (req, res) => {
  let connection;
  try {
    const { employeeId, noteId } = req.params;
    
    connection = await getConnectionWithRetry();
    
    await new Promise((resolve, reject) => {
      connection.query(
        "DELETE FROM sticky_notes WHERE employee_id = ? AND note_id = ?",
        [employeeId, noteId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    
    res.json({ 
      success: true, 
      message: "Note deleted successfully" 
    });
    
  } catch (error) {
    console.error("Error deleting sticky note:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to delete note",
      error: error.message 
    });
  } finally {
    if (connection) connection.release();
  }
});

// Export notes
router.get("/:employeeId/export", async (req, res) => {
  let connection;
  try {
    const { employeeId } = req.params;
    
    connection = await getConnectionWithRetry();
    
    const results = await new Promise((resolve, reject) => {
      connection.query(
        "SELECT * FROM sticky_notes WHERE employee_id = ?",
        [employeeId],
        (err, results) => {
          if (err) reject(err);
          else resolve(results);
        }
      );
    });
    
    res.json({
      success: true,
      employeeId,
      exportDate: new Date().toISOString(),
      notes: results
    });
    
  } catch (error) {
    console.error("Error exporting sticky notes:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to export notes",
      error: error.message 
    });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;