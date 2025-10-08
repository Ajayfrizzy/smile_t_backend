const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { staff_id, password } = req.body;

    if (!staff_id || !password) {
      return res.status(400).json({
        success: false,
        message: 'Staff ID and password are required'
      });
    }

    // Find staff member
    const { data: staff, error } = await supabase
      .from('staff')
      .select('*')
      .eq('staff_id', staff_id)
      .eq('is_active', true)
      .single();

    if (error || !staff) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, staff.password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: staff.id,
        staff_id: staff.staff_id,
        role: staff.role,
        name: staff.name
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Remove password from response
    const { password: _, ...staffData } = staff;

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: staffData
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.json({
    success: true,
    message: 'Logout successful'
  });
});

// GET /api/auth/verify - Verify token
router.get('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get fresh user data
    const { data: staff, error } = await supabase
      .from('staff')
      .select('id, staff_id, name, role, is_active')
      .eq('id', decoded.id)
      .eq('is_active', true)
      .single();

    if (error || !staff) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    res.json({
      success: true,
      user: staff
    });

  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
});

// PUT /api/auth/update-profile - Update user profile
router.put('/update-profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { name, currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    // Get current staff data to verify password
    const { data: staff, error: fetchError } = await supabase
      .from('staff')
      .select('*')
      .eq('id', decoded.id)
      .single();

    if (fetchError || !staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff member not found'
      });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, staff.password);
    if (!isValidPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Prepare update data
    const updateData = { password: hashedPassword };
    
    // Only allow superadmin to change their name
    if (staff.role === 'superadmin' && name && name !== staff.name) {
      updateData.name = name;
    }

    // Update staff record
    const { data: updatedStaff, error: updateError } = await supabase
      .from('staff')
      .update(updateData)
      .eq('id', decoded.id)
      .select('id, staff_id, name, role, is_active')
      .single();

    if (updateError) {
      return res.status(500).json({
        success: false,
        message: 'Failed to update profile'
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedStaff
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// PUT /api/auth/update-settings - Update user settings
router.put('/update-settings', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { emailNotifications, smsAlerts, dailyReports, currency, timeZone } = req.body;

    // Validate decoded token has required fields
    if (!decoded.id) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    // For now, we'll just validate the user exists and return success
    // Settings can be stored in a future database migration
    const { data: staff, error: staffError } = await supabase
      .from('staff')
      .select('id, staff_id, name, role')
      .eq('id', decoded.id)
      .single();

    if (staffError || !staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff member not found'
      });
    }

    // Log the settings for debugging (in production, you'd save to database)
    console.log('Settings update for user:', staff.staff_id, {
      emailNotifications,
      smsAlerts,
      dailyReports,
      currency: currency || 'NGN',
      timeZone: timeZone || 'Africa/Lagos'
    });

    // Return success response
    res.json({
      success: true,
      message: 'Settings updated successfully'
    });

  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// POST /api/auth/change-password
router.post('/change-password', async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token required'
      });
    }

    const token = authHeader.substring(7);
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const staffId = decoded.id;

      if (!current_password || !new_password) {
        return res.status(400).json({
          success: false,
          message: 'Current password and new password are required'
        });
      }

      if (new_password.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'New password must be at least 6 characters long'
        });
      }

      // Get current staff data
      const { data: staff, error: fetchError } = await supabase
        .from('staff')
        .select('*')
        .eq('id', staffId)
        .single();

      if (fetchError || !staff) {
        return res.status(404).json({
          success: false,
          message: 'Staff member not found'
        });
      }

      // Verify current password
      const isCurrentPasswordValid = await bcrypt.compare(current_password, staff.password);
      if (!isCurrentPasswordValid) {
        return res.status(400).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }

      // Hash new password
      const saltRounds = 10;
      const hashedNewPassword = await bcrypt.hash(new_password, saltRounds);

      // Update password in database
      const { error: updateError } = await supabase
        .from('staff')
        .update({ password: hashedNewPassword })
        .eq('id', staffId);

      if (updateError) {
        return res.status(500).json({
          success: false,
          message: 'Failed to update password'
        });
      }

      res.json({
        success: true,
        message: 'Password changed successfully'
      });

    } catch (jwtError) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;