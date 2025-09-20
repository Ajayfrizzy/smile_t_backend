require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createSuperAdmin() {
  const name = 'Super Admin';
  const staff_id = 'superadmin';
  const password = 'Super@123456';
  const role = 'superadmin';
  const is_active = true;

  // Hash the password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Insert into Supabase
  const { data, error } = await supabase.from('staff').insert([
    { name, staff_id, password: hashedPassword, role, is_active }
  ]);

  if (error) {
    console.error('Error creating SuperAdmin:', error.message);
  } else {
    console.log('SuperAdmin created:', data);
  }
}

createSuperAdmin();
