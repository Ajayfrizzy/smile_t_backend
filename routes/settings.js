// PUT update password and settings
router.put('/settings', requireRole(['superadmin', 'supervisor', 'receptionist', 'barmen']), async (req, res) => {
  try {
    const { currentPassword, newPassword, name } = req.body;
    const userId = req.user.id;

    // Get user's current data
    const { data: staff, error: fetchError } = await supabase
      .from('staff')
      .select('password')
      .eq('id', userId)
      .single();

    if (fetchError || !staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found'
      });
    }

    // If updating password, validate current password
    if (currentPassword && newPassword) {
      const isValidPassword = await bcrypt.compare(currentPassword, staff.password).catch(() => {
        return staff.password === currentPassword;
      });

      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update password
      const { error: updateError } = await supabase
        .from('staff')
        .update({ password: hashedPassword })
        .eq('id', userId);

      if (updateError) {
        return res.status(500).json({
          success: false,
          message: 'Failed to update password'
        });
      }
    }

    // If updating name
    if (name) {
      const { error: updateError } = await supabase
        .from('staff')
        .update({ name })
        .eq('id', userId);

      if (updateError) {
        return res.status(500).json({
          success: false,
          message: 'Failed to update name'
        });
      }
    }

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