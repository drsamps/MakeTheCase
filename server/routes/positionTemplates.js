import express from 'express';
import { pool } from '../db.js';
import { verifyToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/position-templates - List all templates (system + user-created)
router.get('/', async (req, res) => {
  try {
    const [templates] = await pool.execute(
      `SELECT template_id, template_name, template_description, is_system_template, created_by, created_at
       FROM position_templates
       ORDER BY is_system_template DESC, template_name ASC`
    );

    // Fetch items for each template
    const templatesWithItems = await Promise.all(templates.map(async (template) => {
      const [items] = await pool.execute(
        `SELECT item_id, position_name, position, position_order
         FROM position_template_items
         WHERE template_id = ?
         ORDER BY position_order ASC`,
        [template.template_id]
      );
      return { ...template, items };
    }));

    res.json({ data: templatesWithItems, error: null });
  } catch (error) {
    console.error('Error fetching position templates:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// GET /api/position-templates/:id - Get single template with items
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [templates] = await pool.execute(
      `SELECT template_id, template_name, template_description, is_system_template, created_by, created_at
       FROM position_templates
       WHERE template_id = ?`,
      [id]
    );

    if (templates.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Template not found' } });
    }

    const [items] = await pool.execute(
      `SELECT item_id, position_name, position, position_order
       FROM position_template_items
       WHERE template_id = ?
       ORDER BY position_order ASC`,
      [id]
    );

    res.json({ data: { ...templates[0], items }, error: null });
  } catch (error) {
    console.error('Error fetching position template:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/position-templates - Create custom template (admin only)
router.post('/', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { template_name, template_description, items } = req.body;

    if (!template_name) {
      return res.status(400).json({
        data: null,
        error: { message: 'template_name is required' }
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        data: null,
        error: { message: 'items array with at least one position is required' }
      });
    }

    // Check for duplicate template name
    const [existing] = await pool.execute(
      'SELECT template_id FROM position_templates WHERE template_name = ?',
      [template_name]
    );
    if (existing.length > 0) {
      return res.status(409).json({
        data: null,
        error: { message: `A template with name "${template_name}" already exists` }
      });
    }

    // Create template
    const [result] = await pool.execute(
      `INSERT INTO position_templates (template_name, template_description, is_system_template, created_by)
       VALUES (?, ?, 0, ?)`,
      [template_name, template_description || null, req.user?.id || null]
    );

    const templateId = result.insertId;

    // Insert items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await pool.execute(
        `INSERT INTO position_template_items (template_id, position_name, position, position_order)
         VALUES (?, ?, ?, ?)`,
        [templateId, item.position_name, item.position, item.position_order ?? i]
      );
    }

    // Return created template with items
    const [createdItems] = await pool.execute(
      `SELECT item_id, position_name, position, position_order
       FROM position_template_items
       WHERE template_id = ?
       ORDER BY position_order ASC`,
      [templateId]
    );

    res.status(201).json({
      data: {
        template_id: templateId,
        template_name,
        template_description: template_description || null,
        is_system_template: 0,
        items: createdItems
      },
      error: null
    });
  } catch (error) {
    console.error('Error creating position template:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// DELETE /api/position-templates/:id - Delete custom template (admin only)
router.delete('/:id', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if template exists and is not a system template
    const [existing] = await pool.execute(
      'SELECT template_id, template_name, is_system_template FROM position_templates WHERE template_id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Template not found' } });
    }

    if (existing[0].is_system_template) {
      return res.status(403).json({
        data: null,
        error: { message: 'Cannot delete system templates' }
      });
    }

    await pool.execute('DELETE FROM position_templates WHERE template_id = ?', [id]);

    res.json({ data: { deleted: true, template_name: existing[0].template_name }, error: null });
  } catch (error) {
    console.error('Error deleting position template:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

// POST /api/position-templates/:id/apply/:scenarioId - Apply template to scenario (admin only)
router.post('/:id/apply/:scenarioId', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { id, scenarioId } = req.params;
    const { clear_existing = false } = req.body;

    // Check if template exists
    const [template] = await pool.execute(
      'SELECT template_id, template_name FROM position_templates WHERE template_id = ?',
      [id]
    );

    if (template.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Template not found' } });
    }

    // Check if scenario exists
    const [scenario] = await pool.execute(
      'SELECT id, scenario_name FROM case_scenarios WHERE id = ?',
      [scenarioId]
    );

    if (scenario.length === 0) {
      return res.status(404).json({ data: null, error: { message: 'Scenario not found' } });
    }

    // Get template items
    const [templateItems] = await pool.execute(
      `SELECT position_name, position, position_order
       FROM position_template_items
       WHERE template_id = ?
       ORDER BY position_order ASC`,
      [id]
    );

    if (templateItems.length === 0) {
      return res.status(400).json({
        data: null,
        error: { message: 'Template has no positions to apply' }
      });
    }

    // Clear existing positions if requested
    if (clear_existing) {
      // Check if any existing positions have chats
      const [positionsWithChats] = await pool.execute(
        `SELECT sp.position_id FROM scenario_positions sp
         WHERE sp.scenario_id = ?
         AND (EXISTS (SELECT 1 FROM case_chats cc WHERE cc.initial_position_id = sp.position_id)
              OR EXISTS (SELECT 1 FROM case_chats cc WHERE cc.final_position_id = sp.position_id))`,
        [scenarioId]
      );

      if (positionsWithChats.length > 0) {
        return res.status(409).json({
          data: null,
          error: { message: 'Cannot clear existing positions: some have associated chats' }
        });
      }

      await pool.execute('DELETE FROM scenario_positions WHERE scenario_id = ?', [scenarioId]);
    }

    // Get existing position names to avoid duplicates
    const [existingPositions] = await pool.execute(
      'SELECT position_name FROM scenario_positions WHERE scenario_id = ?',
      [scenarioId]
    );
    const existingNames = new Set(existingPositions.map(p => p.position_name));

    // Get max position_order
    const [maxOrder] = await pool.execute(
      'SELECT COALESCE(MAX(position_order), -1) + 1 as next_order FROM scenario_positions WHERE scenario_id = ?',
      [scenarioId]
    );
    let nextOrder = maxOrder[0].next_order;

    // Insert template positions
    let createdCount = 0;
    let skippedCount = 0;

    for (const item of templateItems) {
      if (existingNames.has(item.position_name)) {
        skippedCount++;
        continue;
      }

      await pool.execute(
        `INSERT INTO scenario_positions (scenario_id, position_name, position, position_order, position_enabled)
         VALUES (?, ?, ?, ?, 1)`,
        [scenarioId, item.position_name, item.position, nextOrder++]
      );
      createdCount++;
    }

    // Return all positions for the scenario
    const [positions] = await pool.execute(
      `SELECT position_id, scenario_id, position_name, position, position_order,
              arguments_for, arguments_against, position_enabled,
              created_at, updated_at
       FROM scenario_positions
       WHERE scenario_id = ?
       ORDER BY position_order ASC`,
      [scenarioId]
    );

    res.json({
      data: positions,
      message: `Applied template "${template[0].template_name}": created ${createdCount} position(s)${skippedCount > 0 ? `, skipped ${skippedCount} duplicate(s)` : ''}`,
      error: null
    });
  } catch (error) {
    console.error('Error applying position template:', error);
    res.status(500).json({ data: null, error: { message: error.message } });
  }
});

export default router;
