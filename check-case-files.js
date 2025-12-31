#!/usr/bin/env node
// Diagnostic script to check if case files exist
// Run this on the production server to diagnose the issue

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkCaseFiles() {
  console.log('=== MakeTheCase Case Files Diagnostic ===\n');
  console.log('Current directory:', process.cwd());
  console.log('Script directory:', __dirname);
  
  const caseFilesDir = path.join(__dirname, 'case_files');
  console.log('\nChecking for case_files directory:', caseFilesDir);
  
  try {
    const stat = await fs.stat(caseFilesDir);
    if (stat.isDirectory()) {
      console.log('✓ case_files directory exists\n');
      
      // List all case directories
      const entries = await fs.readdir(caseFilesDir, { withFileTypes: true });
      const caseDirs = entries.filter(e => e.isDirectory());
      
      console.log(`Found ${caseDirs.length} case directories:`);
      
      for (const dir of caseDirs) {
        console.log(`\n  Case: ${dir.name}`);
        const caseDir = path.join(caseFilesDir, dir.name);
        
        // Check for case.md
        try {
          const caseMd = await fs.readFile(path.join(caseDir, 'case.md'), 'utf-8');
          console.log(`    ✓ case.md exists (${caseMd.length} bytes)`);
        } catch (e) {
          console.log(`    ✗ case.md missing or unreadable: ${e.message}`);
        }
        
        // Check for teaching_note.md
        try {
          const teachingNote = await fs.readFile(path.join(caseDir, 'teaching_note.md'), 'utf-8');
          console.log(`    ✓ teaching_note.md exists (${teachingNote.length} bytes)`);
        } catch (e) {
          console.log(`    ✗ teaching_note.md missing or unreadable: ${e.message}`);
        }
      }
    }
  } catch (e) {
    console.log('✗ case_files directory does not exist or is not accessible');
    console.log('  Error:', e.message);
    console.log('\n*** THIS IS THE PROBLEM ***');
    console.log('The case_files directory needs to be deployed to the production server.');
    console.log('Please ensure git is tracking this directory and run git pull on the server.\n');
  }
  
  console.log('\n=== End Diagnostic ===');
}

checkCaseFiles();
