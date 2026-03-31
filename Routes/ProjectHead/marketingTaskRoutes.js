const express = require("express");
const router = express.Router();
const { queryWithRetry } = require("../../dataBase/connection");

// =============================================
// CATEGORY ROUTES
// =============================================

router.get('/categories', async (req, res) => {
    try {
        const categories = await queryWithRetry(
            'SELECT category_id, category_name FROM marketing_task_categories ORDER BY category_name'
        );
        res.json({ success: true, data: categories });
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch categories' });
    }
});

router.post('/categories', async (req, res) => {
    try {
        const { category_name } = req.body;
        
        if (!category_name || !category_name.trim()) {
            return res.status(400).json({ success: false, message: 'Category name is required' });
        }

        const existing = await queryWithRetry(
            'SELECT category_id FROM marketing_task_categories WHERE category_name = ?',
            [category_name.trim()]
        );

        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'Category already exists' });
        }

        const result = await queryWithRetry(
            'INSERT INTO marketing_task_categories (category_name) VALUES (?)',
            [category_name.trim()]
        );

        res.json({ 
            success: true, 
            message: 'Category added successfully',
            data: { category_id: result.insertId, category_name: category_name.trim() }
        });
    } catch (error) {
        console.error('Error adding category:', error);
        res.status(500).json({ success: false, message: 'Failed to add category' });
    }
});

router.delete('/categories/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const tasks = await queryWithRetry(
            'SELECT task_id FROM marketing_tasks WHERE category_id = ? LIMIT 1',
            [id]
        );

        if (tasks.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete category. It is being used by existing tasks.' 
            });
        }

        await queryWithRetry(
            'DELETE FROM marketing_task_categories WHERE category_id = ?',
            [id]
        );

        res.json({ success: true, message: 'Category deleted successfully' });
    } catch (error) {
        console.error('Error deleting category:', error);
        res.status(500).json({ success: false, message: 'Failed to delete category' });
    }
});

// =============================================
// EMPLOYEES ROUTES
// =============================================

router.get('/employees', async (req, res) => {
    try {
        const employees = await queryWithRetry(
            `SELECT 
                employee_id,
                employee_name 
             FROM employees_details 
             WHERE designation = 'Digital Marketing & HR' 
             AND working_status = 'Active'
             ORDER BY employee_name`
        );
        res.json({ success: true, data: employees });
    } catch (error) {
        console.error('Error fetching employees:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch employees' });
    }
});

// =============================================
// TASKS ROUTES
// =============================================

router.get('/tasks', async (req, res) => {
    try {
        const { task_type } = req.query;
        
        let query = `
            SELECT t.task_id, t.task_name, t.task_type, t.description, t.to_assign,
                   c.category_id, c.category_name
            FROM marketing_tasks t
            JOIN marketing_task_categories c ON t.category_id = c.category_id
        `;
        
        const params = [];
        if (task_type) {
            query += ' WHERE t.task_type = ?';
            params.push(task_type);
        }
        
        query += ' ORDER BY t.task_name';

        const tasks = await queryWithRetry(query, params);
        res.json({ success: true, data: tasks });
    } catch (error) {
        console.error('Error fetching tasks:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch tasks' });
    }
});

router.get('/tasks/counts', async (req, res) => {
    try {
        const counts = await queryWithRetry(`
            SELECT task_type, COUNT(*) as count
            FROM marketing_tasks
            GROUP BY task_type
        `);
        
        const result = {
            Daily: 0,
            Weekly: 0,
            Monthly: 0
        };
        
        counts.forEach(row => {
            result[row.task_type] = row.count;
        });

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Error fetching task counts:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch task counts' });
    }
});

router.post('/tasks', async (req, res) => {
    try {
        const { task_name, category_id, task_type, description, assign_dates } = req.body;

        if (!task_name || !category_id || !task_type) {
            return res.status(400).json({ 
                success: false, 
                message: 'Task name, category, and task type are required' 
            });
        }

        const result = await queryWithRetry(
            `INSERT INTO marketing_tasks (task_name, category_id, task_type, description, to_assign) 
             VALUES (?, ?, ?, ?, ?)`,
            [task_name.trim(), category_id, task_type, description?.trim() || null, assign_dates?.trim() || null]
        );

        const newTask = await queryWithRetry(`
            SELECT t.task_id, t.task_name, t.task_type, t.description, t.to_assign,
                   c.category_id, c.category_name
            FROM marketing_tasks t
            JOIN marketing_task_categories c ON t.category_id = c.category_id
            WHERE t.task_id = ?
        `, [result.insertId]);

        res.json({ 
            success: true, 
            message: 'Task added successfully',
            data: newTask[0]
        });
    } catch (error) {
        console.error('Error adding task:', error);
        res.status(500).json({ success: false, message: 'Failed to add task' });
    }
});

router.put('/tasks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { task_name, category_id, task_type, description, to_assign } = req.body;

        if (!task_name || !category_id || !task_type) {
            return res.status(400).json({ 
                success: false, 
                message: 'Task name, category, and task type are required' 
            });
        }

        await queryWithRetry(
            `UPDATE marketing_tasks 
             SET task_name = ?, category_id = ?, task_type = ?, description = ?, to_assign = ?
             WHERE task_id = ?`,
            [task_name.trim(), category_id, task_type, description?.trim() || null, to_assign?.trim() || null, id]
        );

        res.json({ success: true, message: 'Task updated successfully' });
    } catch (error) {
        console.error('Error updating task:', error);
        res.status(500).json({ success: false, message: 'Failed to update task' });
    }
});

router.delete('/tasks/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const assignments = await queryWithRetry(
            'SELECT assignment_id FROM marketing_task_assignments WHERE task_id = ? LIMIT 1',
            [id]
        );

        if (assignments.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete task. It has existing assignments. Delete assignments first.' 
            });
        }

        await queryWithRetry(
            'DELETE FROM marketing_tasks WHERE task_id = ?',
            [id]
        );

        res.json({ success: true, message: 'Task deleted successfully' });
    } catch (error) {
        console.error('Error deleting task:', error);
        res.status(500).json({ success: false, message: 'Failed to delete task' });
    }
});

// =============================================
// ASSIGNMENT ROUTES (Updated with Dynamic Status)
// =============================================

const DISPLAY_STATUS_SQL = `
    CASE 
        WHEN a.status = 'Completed' AND DATE(a.updated_at) <= a.assigned_date THEN 'Completed'
        WHEN a.status = 'Completed' AND DATE(a.updated_at) > a.assigned_date THEN 'Delayed'
        WHEN a.status = 'Assigned' AND a.assigned_date = CURDATE() THEN 'In Progress'
        WHEN a.status = 'Assigned' AND a.assigned_date < CURDATE() THEN 'Overdue'
        WHEN a.status = 'Assigned' AND a.assigned_date > CURDATE() THEN 'Not Started'
        ELSE 'Unknown'
    END
`;

router.get('/assignments', async (req, res) => {
    try {
        const { status, date_from, date_to, employee_id, task_type, created_from, created_to } = req.query;

        let query = `
            SELECT 
                a.assignment_id,
                a.task_id,
                t.task_name,
                t.task_type,
                t.description AS task_description,
                c.category_id,
                c.category_name,
                a.employee_id,
                e.employee_name,
                a.assigned_date,
                a.status AS db_status,
                a.remarks,
                a.created_at,
                a.updated_at,
                ${DISPLAY_STATUS_SQL} AS status
            FROM marketing_task_assignments a
            JOIN marketing_tasks t ON a.task_id = t.task_id
            JOIN marketing_task_categories c ON t.category_id = c.category_id
            JOIN employees_details e ON a.employee_id = e.employee_id
            WHERE 1=1
        `;

        const params = [];

        if (status) {
            switch (status) {
                case 'Completed':
                    query += " AND a.status = 'Completed' AND DATE(a.updated_at) <= a.assigned_date";
                    break;
                case 'Delayed':
                    query += " AND a.status = 'Completed' AND DATE(a.updated_at) > a.assigned_date";
                    break;
                case 'In Progress':
                    query += " AND a.status = 'Assigned' AND a.assigned_date = CURDATE()";
                    break;
                case 'Overdue':
                    query += " AND a.status = 'Assigned' AND a.assigned_date < CURDATE()";
                    break;
                case 'Not Started':
                    query += " AND a.status = 'Assigned' AND a.assigned_date > CURDATE()";
                    break;
            }
        }

        if (date_from && date_to) {
            query += ' AND a.assigned_date BETWEEN ? AND ?';
            params.push(date_from, date_to);
        } else if (date_from) {
            query += ' AND a.assigned_date = ?';
            params.push(date_from);
        }

        if (created_from && created_to) {
            query += ' AND DATE(a.created_at) BETWEEN ? AND ?';
            params.push(created_from, created_to);
        } else if (created_from) {
            query += ' AND DATE(a.created_at) = ?';
            params.push(created_from);
        }

        if (employee_id) {
            query += ' AND a.employee_id = ?';
            params.push(employee_id);
        }

        if (task_type) {
            query += ' AND t.task_type = ?';
            params.push(task_type);
        }

        query += ' ORDER BY a.assigned_date DESC, a.assignment_id DESC';

        const assignments = await queryWithRetry(query, params);
        res.json({ success: true, data: assignments });
    } catch (error) {
        console.error('Error fetching assignments:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch assignments' });
    }
});

router.get('/assignments/status-counts', async (req, res) => {
    try {
        const { employee_id } = req.query;

        let whereClause = '';
        const params = [];

        if (employee_id) {
            whereClause = 'WHERE a.employee_id = ?';
            params.push(employee_id);
        }

        const counts = await queryWithRetry(`
            SELECT 
                SUM(CASE 
                    WHEN a.status = 'Assigned' AND a.assigned_date > CURDATE() 
                    THEN 1 ELSE 0 
                END) AS 'Not Started',
                
                SUM(CASE 
                    WHEN a.status = 'Assigned' AND a.assigned_date = CURDATE() 
                    THEN 1 ELSE 0 
                END) AS 'In Progress',
                
                SUM(CASE 
                    WHEN a.status = 'Assigned' AND a.assigned_date < CURDATE() 
                    THEN 1 ELSE 0 
                END) AS 'Overdue',
                
                SUM(CASE 
                    WHEN a.status = 'Completed' AND DATE(a.updated_at) <= a.assigned_date 
                    THEN 1 ELSE 0 
                END) AS 'Completed',
                
                SUM(CASE 
                    WHEN a.status = 'Completed' AND DATE(a.updated_at) > a.assigned_date 
                    THEN 1 ELSE 0 
                END) AS 'Delayed',
                
                COUNT(*) AS 'Total'
            FROM marketing_task_assignments a
            ${whereClause}
        `, params);

        const result = {
            'Not Started': parseInt(counts[0]['Not Started']) || 0,
            'In Progress': parseInt(counts[0]['In Progress']) || 0,
            'Overdue': parseInt(counts[0]['Overdue']) || 0,
            'Completed': parseInt(counts[0]['Completed']) || 0,
            'Delayed': parseInt(counts[0]['Delayed']) || 0,
            'Total': parseInt(counts[0]['Total']) || 0
        };

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Error fetching status counts:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch status counts' });
    }
});

router.get('/assignments/existing-dates', async (req, res) => {
    try {
        const { task_id, employee_id } = req.query;

        if (!task_id || !employee_id) {
            return res.status(400).json({ 
                success: false, 
                message: 'Task ID and Employee ID are required' 
            });
        }

        const dates = await queryWithRetry(
            `SELECT DATE_FORMAT(assigned_date, '%Y-%m-%d') as date
             FROM marketing_task_assignments
             WHERE task_id = ? AND employee_id = ?`,
            [task_id, employee_id]
        );

        res.json({ success: true, data: dates.map(d => d.date) });
    } catch (error) {
        console.error('Error fetching existing dates:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch existing dates' });
    }
});

router.post('/assignments', async (req, res) => {
    try {
        const { task_id, employee_id, dates } = req.body;

        if (!task_id || !employee_id || !dates || !Array.isArray(dates) || dates.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Task ID, Employee ID, and dates array are required' 
            });
        }

        const sundayDates = dates.filter(date => new Date(date).getDay() === 0);
        if (sundayDates.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot assign tasks on Sundays' 
            });
        }

        const placeholders = dates.map(() => '?').join(',');
        const existing = await queryWithRetry(
            `SELECT DATE_FORMAT(assigned_date, '%Y-%m-%d') as date
             FROM marketing_task_assignments
             WHERE task_id = ? AND employee_id = ? AND assigned_date IN (${placeholders})`,
            [task_id, employee_id, ...dates]
        );

        if (existing.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: `Task already assigned on: ${existing.map(e => e.date).join(', ')}` 
            });
        }

        // Insert with status 'Assigned'
        for (const date of dates) {
            await queryWithRetry(
                `INSERT INTO marketing_task_assignments (task_id, employee_id, assigned_date, status, created_at) 
                 VALUES (?, ?, ?, 'Assigned', NOW())`,
                [task_id, employee_id, date]
            );
        }

        res.json({ 
            success: true, 
            message: `${dates.length} assignment(s) created successfully` 
        });
    } catch (error) {
        console.error('Error creating assignments:', error);
        res.status(500).json({ success: false, message: 'Failed to create assignments' });
    }
});

router.put('/assignments/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { assigned_date, status } = req.body;

        const current = await queryWithRetry(
            'SELECT task_id, employee_id, assigned_date, status FROM marketing_task_assignments WHERE assignment_id = ?',
            [id]
        );

        if (current.length === 0) {
            return res.status(404).json({ success: false, message: 'Assignment not found' });
        }

        // Only allow date change if not completed
        if (assigned_date && current[0].status === 'Completed') {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot change assigned date for completed tasks' 
            });
        }

        if (assigned_date) {
            if (new Date(assigned_date).getDay() === 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Cannot assign task on Sunday' 
                });
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const newDate = new Date(assigned_date);
            newDate.setHours(0, 0, 0, 0);
            
            if (newDate < today) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Cannot assign task to a past date' 
                });
            }

            const existing = await queryWithRetry(
                `SELECT assignment_id FROM marketing_task_assignments 
                 WHERE task_id = ? AND employee_id = ? AND assigned_date = ? AND assignment_id != ?`,
                [current[0].task_id, current[0].employee_id, assigned_date, id]
            );

            if (existing.length > 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Task already assigned to this employee on the selected date' 
                });
            }
        }

        // Validate status - only allow 'Assigned' or 'Completed'
        if (status && !['Assigned', 'Completed'].includes(status)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid status. Status must be "Assigned" or "Completed"' 
            });
        }

        const updateFields = [];
        const updateValues = [];

        if (assigned_date) {
            updateFields.push('assigned_date = ?');
            updateValues.push(assigned_date);
        }

        if (status) {
            updateFields.push('status = ?');
            updateValues.push(status);
            // Update timestamp when status changes
            updateFields.push('updated_at = NOW()');
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
        }

        updateValues.push(id);

        await queryWithRetry(
            `UPDATE marketing_task_assignments SET ${updateFields.join(', ')} WHERE assignment_id = ?`,
            updateValues
        );

        res.json({ success: true, message: 'Assignment updated successfully' });
    } catch (error) {
        console.error('Error updating assignment:', error);
        res.status(500).json({ success: false, message: 'Failed to update assignment' });
    }
});

router.delete('/assignments/:id', async (req, res) => {
    try {
        const { id } = req.params;

        await queryWithRetry(
            'DELETE FROM marketing_task_assignments WHERE assignment_id = ?',
            [id]
        );

        res.json({ success: true, message: 'Assignment deleted successfully' });
    } catch (error) {
        console.error('Error deleting assignment:', error);
        res.status(500).json({ success: false, message: 'Failed to delete assignment' });
    }
});

// =============================================
// EMPLOYEE TASK UPDATE ROUTES
// =============================================

router.get('/my-tasks', async (req, res) => {
    try {
        const { employee_id, date_filter, status, date_from, date_to } = req.query;

        if (!employee_id) {
            return res.status(400).json({ 
                success: false, 
                message: 'Employee ID is required' 
            });
        }

        let query = `
            SELECT 
                a.assignment_id,
                a.task_id,
                t.task_name,
                t.task_type,
                t.description AS task_description,
                c.category_id,
                c.category_name,
                a.employee_id,
                a.assigned_date,
                a.status AS db_status,
                a.remarks,
                a.updated_at,
                a.created_at,
                ${DISPLAY_STATUS_SQL} AS status
            FROM marketing_task_assignments a
            JOIN marketing_tasks t ON a.task_id = t.task_id
            JOIN marketing_task_categories c ON t.category_id = c.category_id
            WHERE a.employee_id = ?
        `;

        const params = [employee_id];

        // Date filters - these take precedence
        if (date_filter === 'today') {
            // Today: Show only tasks assigned today that are still pending (Assigned status)
            query += ' AND a.assigned_date = CURDATE()';
            query += " AND a.status = 'Assigned'";
        } else if (date_filter === 'week') {
            // This Week: Show tasks for current week (today + next 7 days), exclude completed ones
            query += ' AND a.assigned_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)';
            query += " AND a.status = 'Assigned'";
        } else if (date_filter === 'overdue') {
            // Overdue: Show past tasks that are not completed
            query += " AND a.assigned_date < CURDATE() AND a.status = 'Assigned'";
        } else {
            // All Tasks - apply date range and status filters if provided
            
            // Date range filter
            if (date_from && date_to) {
                query += ' AND a.assigned_date BETWEEN ? AND ?';
                params.push(date_from, date_to);
            } else if (date_from) {
                query += ' AND a.assigned_date = ?';
                params.push(date_from);
            }
            
            // Status filter
            if (status) {
                switch (status) {
                    case 'Completed':
                        query += " AND a.status = 'Completed' AND DATE(a.updated_at) <= a.assigned_date";
                        break;
                    case 'Delayed':
                        query += " AND a.status = 'Completed' AND DATE(a.updated_at) > a.assigned_date";
                        break;
                    case 'In Progress':
                        query += " AND a.status = 'Assigned' AND a.assigned_date = CURDATE()";
                        break;
                    case 'Overdue':
                        query += " AND a.status = 'Assigned' AND a.assigned_date < CURDATE()";
                        break;
                    case 'Not Started':
                        query += " AND a.status = 'Assigned' AND a.assigned_date > CURDATE()";
                        break;
                }
            }
        }

        query += ' ORDER BY a.assigned_date ASC, a.assignment_id DESC';

        const tasks = await queryWithRetry(query, params);
        res.json({ success: true, data: tasks });
    } catch (error) {
        console.error('Error fetching employee tasks:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch tasks' });
    }
});

router.get('/my-tasks/counts', async (req, res) => {
    try {
        const { employee_id } = req.query;

        if (!employee_id) {
            return res.status(400).json({ 
                success: false, 
                message: 'Employee ID is required' 
            });
        }

        const counts = await queryWithRetry(`
            SELECT 
                SUM(CASE 
                    WHEN status = 'Assigned' AND assigned_date > CURDATE() 
                    THEN 1 ELSE 0 
                END) AS 'Not Started',
                
                SUM(CASE 
                    WHEN status = 'Assigned' AND assigned_date = CURDATE() 
                    THEN 1 ELSE 0 
                END) AS 'In Progress',
                
                SUM(CASE 
                    WHEN status = 'Assigned' AND assigned_date < CURDATE() 
                    THEN 1 ELSE 0 
                END) AS 'Overdue',
                
                SUM(CASE 
                    WHEN status = 'Completed' AND DATE(updated_at) <= assigned_date 
                    THEN 1 ELSE 0 
                END) AS 'Completed',
                
                SUM(CASE 
                    WHEN status = 'Completed' AND DATE(updated_at) > assigned_date 
                    THEN 1 ELSE 0 
                END) AS 'Delayed',
                
                SUM(CASE 
                    WHEN assigned_date = CURDATE() AND status = 'Assigned'
                    THEN 1 ELSE 0 
                END) AS 'TodayTotal',
                
                COUNT(*) AS 'Total'
            FROM marketing_task_assignments
            WHERE employee_id = ?
        `, [employee_id]);

        const result = {
            'Not Started': parseInt(counts[0]['Not Started']) || 0,
            'In Progress': parseInt(counts[0]['In Progress']) || 0,
            'Completed': parseInt(counts[0]['Completed']) || 0,
            'Overdue': parseInt(counts[0]['Overdue']) || 0,
            'Delayed': parseInt(counts[0]['Delayed']) || 0,
            'Today': parseInt(counts[0]['TodayTotal']) || 0,
            'OverdueTasks': parseInt(counts[0]['Overdue']) || 0,
            'Total': parseInt(counts[0]['Total']) || 0
        };

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Error fetching task counts:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch task counts' });
    }
});

router.put('/my-tasks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, remarks, employee_id } = req.body;

        if (!status) {
            return res.status(400).json({ 
                success: false, 
                message: 'Status is required' 
            });
        }

        // Validate status - only allow 'Assigned' or 'Completed'
        if (!['Assigned', 'Completed'].includes(status)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid status. Status must be "Assigned" or "Completed"' 
            });
        }

        // Verify assignment belongs to employee
        const assignment = await queryWithRetry(
            'SELECT assignment_id, status FROM marketing_task_assignments WHERE assignment_id = ? AND employee_id = ?',
            [id, employee_id]
        );

        if (assignment.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Assignment not found or access denied' 
            });
        }

        await queryWithRetry(
            `UPDATE marketing_task_assignments 
             SET status = ?, remarks = ?, updated_at = NOW()
             WHERE assignment_id = ?`,
            [status, remarks?.trim() || null, id]
        );

        res.json({ success: true, message: 'Task updated successfully' });
    } catch (error) {
        console.error('Error updating task:', error);
        res.status(500).json({ success: false, message: 'Failed to update task' });
    }
});

module.exports = router;