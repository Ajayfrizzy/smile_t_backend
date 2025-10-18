// Security Utilities
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Password Validation
 * Enforces strong password requirements for NEW accounts only
 */
const validatePassword = (password) => {
  const errors = [];
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character (!@#$%^&*(),.?":{}|<>)');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Account Lockout Management
 */
const checkAccountLockout = async (staff_id) => {
  try {
    const { data: staff, error } = await supabase
      .from('staff')
      .select('locked_until, failed_login_attempts')
      .eq('staff_id', staff_id)
      .single();
    
    if (error || !staff) {
      return { isLocked: false, remainingTime: 0 };
    }
    
    // Check if account is locked
    if (staff.locked_until) {
      const lockedUntil = new Date(staff.locked_until);
      const now = new Date();
      
      if (now < lockedUntil) {
        const remainingMs = lockedUntil - now;
        const remainingMinutes = Math.ceil(remainingMs / 1000 / 60);
        return {
          isLocked: true,
          remainingTime: remainingMinutes,
          attempts: staff.failed_login_attempts
        };
      } else {
        // Lock expired, reset
        await supabase
          .from('staff')
          .update({
            failed_login_attempts: 0,
            locked_until: null,
            last_failed_login: null
          })
          .eq('staff_id', staff_id);
        
        return { isLocked: false, remainingTime: 0 };
      }
    }
    
    return { isLocked: false, remainingTime: 0, attempts: staff.failed_login_attempts };
  } catch (error) {
    console.error('Error checking account lockout:', error);
    return { isLocked: false, remainingTime: 0 };
  }
};

const recordFailedLogin = async (staff_id, ipAddress, userAgent) => {
  try {
    // Get current failed attempts
    const { data: staff } = await supabase
      .from('staff')
      .select('failed_login_attempts')
      .eq('staff_id', staff_id)
      .single();
    
    const currentAttempts = staff?.failed_login_attempts || 0;
    const newAttempts = currentAttempts + 1;
    
    // Update staff record
    const updateData = {
      failed_login_attempts: newAttempts,
      last_failed_login: new Date().toISOString()
    };
    
    // Lock account if 5 failed attempts
    if (newAttempts >= 5) {
      const lockUntil = new Date();
      lockUntil.setMinutes(lockUntil.getMinutes() + 15); // 15 minute lockout
      updateData.locked_until = lockUntil.toISOString();
    }
    
    await supabase
      .from('staff')
      .update(updateData)
      .eq('staff_id', staff_id);
    
    // Log the attempt
    await supabase
      .from('login_attempts')
      .insert({
        staff_id,
        success: false,
        ip_address: ipAddress,
        user_agent: userAgent
      });
    
    return {
      attempts: newAttempts,
      isLocked: newAttempts >= 5,
      lockDuration: 15 // minutes
    };
  } catch (error) {
    console.error('Error recording failed login:', error);
    return { attempts: 0, isLocked: false };
  }
};

const recordSuccessfulLogin = async (staff_id, ipAddress, userAgent) => {
  try {
    // Reset failed attempts
    await supabase
      .from('staff')
      .update({
        failed_login_attempts: 0,
        locked_until: null,
        last_failed_login: null
      })
      .eq('staff_id', staff_id);
    
    // Log the attempt
    await supabase
      .from('login_attempts')
      .insert({
        staff_id,
        success: true,
        ip_address: ipAddress,
        user_agent: userAgent
      });
  } catch (error) {
    console.error('Error recording successful login:', error);
  }
};

/**
 * Password Expiration Management
 */
const checkPasswordExpiry = async (staff_id) => {
  try {
    const { data: staff, error } = await supabase
      .from('staff')
      .select('password_expires_at, password_changed_at')
      .eq('staff_id', staff_id)
      .single();
    
    if (error || !staff) {
      return { isExpired: false, daysUntilExpiry: 30 };
    }
    
    const expiryDate = new Date(staff.password_expires_at);
    const now = new Date();
    const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
    
    return {
      isExpired: daysUntilExpiry <= 0,
      daysUntilExpiry,
      expiryDate: expiryDate.toISOString(),
      needsWarning: daysUntilExpiry > 0 && daysUntilExpiry <= 5 // Warn 5 days before
    };
  } catch (error) {
    console.error('Error checking password expiry:', error);
    return { isExpired: false, daysUntilExpiry: 30 };
  }
};

const updatePasswordExpiry = async (staff_id) => {
  try {
    const now = new Date();
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30); // 30 days from now
    
    await supabase
      .from('staff')
      .update({
        password_changed_at: now.toISOString(),
        password_expires_at: expiryDate.toISOString()
      })
      .eq('staff_id', staff_id);
    
    return true;
  } catch (error) {
    console.error('Error updating password expiry:', error);
    return false;
  }
};

/**
 * 2FA TOTP Management
 */
const generate2FASecret = (staffName, staffEmail) => {
  const secret = speakeasy.generateSecret({
    name: `Smile-T Continental (${staffName})`,
    issuer: 'Smile-T Continental Hotel',
    length: 32
  });
  
  return {
    secret: secret.base32,
    otpauth_url: secret.otpauth_url
  };
};

const generateQRCode = async (otpauth_url) => {
  try {
    const qrCode = await QRCode.toDataURL(otpauth_url);
    return qrCode; // Returns base64 data URL
  } catch (error) {
    console.error('Error generating QR code:', error);
    throw error;
  }
};

const verify2FAToken = (secret, token) => {
  try {
    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: token,
      window: 2 // Allow 60 second clock skew (30s * 2)
    });
    
    return verified;
  } catch (error) {
    console.error('Error verifying 2FA token:', error);
    return false;
  }
};

const enable2FA = async (staff_id, secret) => {
  try {
    await supabase
      .from('staff')
      .update({
        two_factor_secret: secret,
        two_factor_enabled: true
      })
      .eq('staff_id', staff_id);
    
    return true;
  } catch (error) {
    console.error('Error enabling 2FA:', error);
    return false;
  }
};

const disable2FA = async (staff_id) => {
  try {
    await supabase
      .from('staff')
      .update({
        two_factor_secret: null,
        two_factor_enabled: false
      })
      .eq('staff_id', staff_id);
    
    return true;
  } catch (error) {
    console.error('Error disabling 2FA:', error);
    return false;
  }
};

module.exports = {
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
};
