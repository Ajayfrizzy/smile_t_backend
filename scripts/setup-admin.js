#!/usr/bin/env node
/**
 * Secure Admin Setup Script
 * This script helps you create admin users without exposing credentials in code
 * Run with: node setup-admin.js
 */

const readline = require('readline');
const bcrypt = require('bcrypt');

// This would connect to your database
const setupAdmin = async () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt) => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };

  try {
    console.log(' Admin Setup Utility');
    console.log('====================');
    
    const name = await question('Enter admin name: ');
    const staffId = await question('Enter staff ID: ');
    const password = await question('Enter password: ');
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    console.log('\n Admin User Details:');
    console.log('Name:', name);
    console.log('Staff ID:', staffId);
    console.log('Role: superadmin');
    console.log('\n Hashed Password:', hashedPassword);
    
    console.log('\n SQL to run in Supabase:');
    console.log(`INSERT INTO public.staff (name, staff_id, password, role, is_active)`);
    console.log(`VALUES ('${name}', '${staffId}', '${hashedPassword}', 'superadmin', true)`);
    console.log(`ON CONFLICT (staff_id) DO UPDATE SET password = EXCLUDED.password;`);
    
    console.log('\n Copy the SQL above and run it in your Supabase SQL Editor');
    console.log('  This script does not store or transmit your credentials anywhere');
    
  } catch (error) {
    console.error(' Error:', error.message);
  } finally {
    rl.close();
  }
};

// Only run if this is the main module
if (require.main === module) {
  setupAdmin();
}

module.exports = { setupAdmin };