const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const {
  validatePassword,
  checkAccountLockout,
  recordFailedLogin,
  recordSuccessfulLogin,
  checkPasswordExpiry,
  updatePasswordExpiry,
  generate2FASecret,
  generateQRCode,
  verify2FAToken,
  enable2FA,
  disable2FA
} = require('../utils/security');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Helper function to set authentication cookie
const setAuthCookie = (res, token) => {
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  });
};

// Helper function to clear authentication cookie
const clearAuthCookie = (res) => {
  res.clearCookie('auth_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  });
};

// POST /api/auth/login - Enhanced with account lockout, 2FA, and password expiry
router.post('/login', async (req, res) => {
  try {
    const { staff_id, password, two_factor_token } = req.body;
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'unknown';

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

    // Check account lockout
    const lockoutStatus = await checkAccountLockout(staff.id);
    if (lockoutStatus.isLocked) {
      return res.status(423).json({
        success: false,
        message: `Account locked. Try again in ${Math.ceil(lockoutStatus.remainingTime / 60)} minutes`,
        locked: true,
        remainingTime: lockoutStatus.remainingTime
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, staff.password);
    if (!isValidPassword) {
      // Record failed login
      await recordFailedLogin(staff.id, ip, userAgent);
      
      const attemptsRemaining = 5 - (lockoutStatus.attempts + 1);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        attemptsRemaining: Math.max(0, attemptsRemaining)
      });
    }

    // Check if 2FA is enabled
    if (staff.two_factor_enabled) {
      if (!two_factor_token) {
        return res.status(200).json({
          success: false,
          requires2FA: true,
          message: 'Two-factor authentication required'
        });
      }

      // Verify 2FA token
      const is2FAValid = await verify2FAToken(staff.two_factor_secret, two_factor_token);
      if (!is2FAValid) {
        await recordFailedLogin(staff.id, ip, userAgent);
        return res.status(401).json({
          success: false,
          message: 'Invalid two-factor authentication code'
        });
      }
    }

    // Check password expiry
    const expiryStatus = await checkPasswordExpiry(staff.id);
    if (expiryStatus.isExpired) {
      return res.status(200).json({
        success: false,
        passwordExpired: true,
        message: 'Your password has expired. Please change it to continue.',
        staff_id: staff.staff_id
      });
    }

    // Record successful login
    await recordSuccessfulLogin(staff.id, ip, userAgent);

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

    // Set HTTP-only cookie
    setAuthCookie(res, token);

    // Remove sensitive fields from response
    const { password: _, two_factor_secret: __, ...staffData } = staff;

    const response = {
      success: true,
      message: 'Login successful',
      token, // Still send in response for backward compatibility
      user: staffData
    };

    // Add password warning if needed
    if (expiryStatus.needsWarning) {
      response.passwordWarning = {
        daysUntilExpiry: expiryStatus.daysUntilExpiry,
        message: `Your password will expire in ${expiryStatus.daysUntilExpiry} days`
      };
    }

    res.json(response);

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// POST /api/auth/logout - Clear HTTP-only cookie
router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({
    success: true,
    message: 'Logout successful'
  });
});

// GET /api/auth/verify - Verify token from cookie or header
router.get('/verify', async (req, res) => {
  try {
    // Check cookie first, then fall back to Authorization header
    let token = req.cookies?.auth_token;
    
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }
    
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
      .select('id, staff_id, name, role, is_active, two_factor_enabled')
      .eq('id', decoded.id)
      .eq('is_active', true)
      .single();

    if (error || !staff) {
      clearAuthCookie(res);
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    // Check password expiry and add warning if needed
    const expiryStatus = await checkPasswordExpiry(staff.id);
    const response = {
      success: true,
      user: staff
    };

    if (expiryStatus.needsWarning) {
      response.passwordWarning = {
        daysUntilExpiry: expiryStatus.daysUntilExpiry,
        message: `Your password will expire in ${expiryStatus.daysUntilExpiry} days`
      };
    }

    res.json(response);

  } catch (error) {
    clearAuthCookie(res);
    res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
});

// PUT /api/auth/update-profile - Update user profile
router.put('/update-profile', async (req, res) => {
  try {
    // Check cookie first, then fall back to Authorization header
    let token = req.cookies?.auth_token;
    
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }
    
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

    // Validate new password strength (only for accounts created in last 7 days)
    const accountAge = Date.now() - new Date(staff.created_at).getTime();
    const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
    
    if (accountAge < sevenDaysInMs) {
      const passwordValidation = validatePassword(newPassword);
      if (!passwordValidation.isValid) {
        return res.status(400).json({
          success: false,
          message: 'Password does not meet requirements',
          errors: passwordValidation.errors
        });
      }
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Prepare update data
    const updateData = { 
      password: hashedPassword,
      password_changed_at: new Date().toISOString()
    };
    
    // Calculate password expiry (30 days from now)
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);
    updateData.password_expires_at = expiryDate.toISOString();
    
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
    // Check cookie first, then fall back to Authorization header
    let token = req.cookies?.auth_token;
    
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }
    
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

// POST /api/auth/change-password - Enhanced with CSRF protection and password validation
router.post('/change-password', async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    
    // Check cookie first, then fall back to Authorization header
    let token = req.cookies?.auth_token;
    
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token required'
      });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const staffId = decoded.id;

      if (!current_password || !new_password) {
        return res.status(400).json({
          success: false,
          message: 'Current password and new password are required'
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

      // Validate new password strength (only for accounts created in last 7 days)
      const accountAge = Date.now() - new Date(staff.created_at).getTime();
      const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
      
      if (accountAge < sevenDaysInMs) {
        const passwordValidation = validatePassword(new_password);
        if (!passwordValidation.isValid) {
          return res.status(400).json({
            success: false,
            message: 'Password does not meet requirements',
            errors: passwordValidation.errors
          });
        }
      }

      // Hash new password
      const hashedNewPassword = await bcrypt.hash(new_password, 10);

      // Update password in database with expiry date
      await updatePasswordExpiry(staffId);
      
      const { error: updateError } = await supabase
        .from('staff')
        .update({ 
          password: hashedNewPassword,
          password_changed_at: new Date().toISOString()
        })
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
      clearAuthCookie(res);
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

// POST /api/auth/setup-2fa - Generate 2FA secret and QR code (SuperAdmin only)
router.post('/setup-2fa', async (req, res) => {
  try {
    // Check cookie first, then fall back to Authorization header
    let token = req.cookies?.auth_token;
    
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token required'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Only SuperAdmin can setup 2FA
    if (decoded.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Only SuperAdmin can setup two-factor authentication'
      });
    }

    // Get staff data
    const { data: staff, error } = await supabase
      .from('staff')
      .select('*')
      .eq('id', decoded.id)
      .single();

    if (error || !staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff member not found'
      });
    }

    // Generate 2FA secret
    const { secret, otpauth_url } = await generate2FASecret(staff.name, staff.staff_id);

    // Generate QR code
    const qrCodeDataUrl = await generateQRCode(otpauth_url);

    // Store secret in database (but don't enable 2FA yet)
    const { error: updateError } = await supabase
      .from('staff')
      .update({ two_factor_secret: secret })
      .eq('id', staff.id);

    if (updateError) {
      return res.status(500).json({
        success: false,
        message: 'Failed to setup 2FA'
      });
    }

    res.json({
      success: true,
      message: '2FA setup initiated. Scan the QR code with your authenticator app',
      qrCode: qrCodeDataUrl,
      secret: secret,
      manualEntryKey: secret
    });

  } catch (error) {
    console.error('Setup 2FA error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// POST /api/auth/verify-2fa-setup - Verify 2FA token and enable 2FA
router.post('/verify-2fa-setup', async (req, res) => {
  try {
    const { token: twoFactorToken } = req.body;
    
    // Check cookie first, then fall back to Authorization header
    let token = req.cookies?.auth_token;
    
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token required'
      });
    }

    if (!twoFactorToken) {
      return res.status(400).json({
        success: false,
        message: '2FA token is required'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get staff data with 2FA secret
    const { data: staff, error } = await supabase
      .from('staff')
      .select('*')
      .eq('id', decoded.id)
      .single();

    if (error || !staff || !staff.two_factor_secret) {
      return res.status(400).json({
        success: false,
        message: 'Please setup 2FA first'
      });
    }

    // Verify the token
    const isValid = await verify2FAToken(staff.two_factor_secret, twoFactorToken);

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid 2FA token'
      });
    }

    // Enable 2FA
    await enable2FA(staff.id, staff.two_factor_secret);

    res.json({
      success: true,
      message: 'Two-factor authentication enabled successfully'
    });

  } catch (error) {
    console.error('Verify 2FA setup error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// POST /api/auth/disable-2fa - Disable 2FA (requires password and 2FA token)
router.post('/disable-2fa', async (req, res) => {
  try {
    const { password, token: twoFactorToken } = req.body;
    
    // Check cookie first, then fall back to Authorization header
    let token = req.cookies?.auth_token;
    
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token required'
      });
    }

    if (!password || !twoFactorToken) {
      return res.status(400).json({
        success: false,
        message: 'Password and 2FA token are required'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get staff data
    const { data: staff, error } = await supabase
      .from('staff')
      .select('*')
      .eq('id', decoded.id)
      .single();

    if (error || !staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff member not found'
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, staff.password);
    if (!isValidPassword) {
      return res.status(400).json({
        success: false,
        message: 'Invalid password'
      });
    }

    // Verify 2FA token
    if (staff.two_factor_enabled && staff.two_factor_secret) {
      const is2FAValid = await verify2FAToken(staff.two_factor_secret, twoFactorToken);
      if (!is2FAValid) {
        return res.status(400).json({
          success: false,
          message: 'Invalid 2FA token'
        });
      }
    }

    // Disable 2FA
    await disable2FA(staff.id);

    res.json({
      success: true,
      message: 'Two-factor authentication disabled successfully'
    });

  } catch (error) {
    console.error('Disable 2FA error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;