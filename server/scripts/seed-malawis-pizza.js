/**
 * Seed script to create the Malawi's Pizza case as the first case.
 * 
 * Run with: node server/scripts/seed-malawis-pizza.js
 */

import { pool } from '../db.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CASE_ID = 'malawis-pizza';
const CASE_TITLE = "Malawi's Pizza Catering";
const PROTAGONIST = 'Kent Beck';
const PROTAGONIST_INITIALS = 'KB';
const CHAT_TOPIC = 'Catering business strategy';
const CHAT_QUESTION = "Should we stay in the catering business, or is pizza catering a distraction from our core restaurant operations?";

async function seedMalawisPizza() {
  console.log('Starting Malawi\'s Pizza case seed...');
  
  try {
    // Check if case already exists
    const [existing] = await pool.execute('SELECT case_id FROM cases WHERE case_id = ?', [CASE_ID]);
    if (existing.length > 0) {
      console.log(`Case "${CASE_ID}" already exists. Skipping creation.`);
      console.log('To update case content, delete the existing case first or use the admin dashboard.');
      process.exit(0);
    }
    
    // Create case record
    console.log('Creating case record...');
    await pool.execute(
      `INSERT INTO cases (case_id, case_title, protagonist, protagonist_initials, chat_topic, chat_question, enabled)
       VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
      [CASE_ID, CASE_TITLE, PROTAGONIST, PROTAGONIST_INITIALS, CHAT_TOPIC, CHAT_QUESTION]
    );
    console.log('✓ Case record created');
    
    // Create case_files directory
    const caseDir = path.join(__dirname, '../../case_files', CASE_ID);
    await fs.mkdir(caseDir, { recursive: true });
    console.log(`✓ Created directory: ${caseDir}`);
    
    // Read and save business case content
    console.log('Extracting case content from data/business_case.ts...');
    const businessCasePath = path.join(__dirname, '../../data/business_case.ts');
    const businessCaseContent = await fs.readFile(businessCasePath, 'utf-8');
    
    // Extract the text content from the TypeScript export
    const caseMatch = businessCaseContent.match(/export const BUSINESS_CASE_TEXT\s*=\s*`([\s\S]*?)`;/);
    if (!caseMatch) {
      throw new Error('Could not extract BUSINESS_CASE_TEXT from business_case.ts');
    }
    const caseText = caseMatch[1].trim();
    
    const caseFilePath = path.join(caseDir, 'case.md');
    await fs.writeFile(caseFilePath, caseText, 'utf-8');
    console.log(`✓ Saved case content to ${caseFilePath} (${caseText.length} chars)`);
    
    // Add case_files record for case document
    await pool.execute(
      'INSERT INTO case_files (case_id, filename, file_type) VALUES (?, ?, ?)',
      [CASE_ID, 'case.md', 'case']
    );
    console.log('✓ Created case_files record for case document');
    
    // Read and save teaching note content
    console.log('Extracting teaching note from data/useful_facts.ts...');
    const usefulFactsPath = path.join(__dirname, '../../data/useful_facts.ts');
    const usefulFactsContent = await fs.readFile(usefulFactsPath, 'utf-8');
    
    // Extract the text content from the TypeScript export
    const factsMatch = usefulFactsContent.match(/export const USEFUL_CASE_FACTS\s*=\s*`([\s\S]*?)`;/);
    if (!factsMatch) {
      throw new Error('Could not extract USEFUL_CASE_FACTS from useful_facts.ts');
    }
    const teachingNote = factsMatch[1].trim();
    
    const teachingNotePath = path.join(caseDir, 'teaching_note.md');
    await fs.writeFile(teachingNotePath, teachingNote, 'utf-8');
    console.log(`✓ Saved teaching note to ${teachingNotePath} (${teachingNote.length} chars)`);
    
    // Add case_files record for teaching note
    await pool.execute(
      'INSERT INTO case_files (case_id, filename, file_type) VALUES (?, ?, ?)',
      [CASE_ID, 'teaching_note.md', 'teaching_note']
    );
    console.log('✓ Created case_files record for teaching note');
    
    console.log('\n========================================');
    console.log('SUCCESS! Malawi\'s Pizza case has been seeded.');
    console.log('========================================');
    console.log('\nCase details:');
    console.log(`  ID: ${CASE_ID}`);
    console.log(`  Title: ${CASE_TITLE}`);
    console.log(`  Protagonist: ${PROTAGONIST} (${PROTAGONIST_INITIALS})`);
    console.log(`  Chat Question: ${CHAT_QUESTION.substring(0, 60)}...`);
    console.log('\nNext steps:');
    console.log('1. Go to the admin dashboard → Cases tab to verify');
    console.log('2. Assign this case to a section using Sections → Manage Cases');
    console.log('3. Set it as Active to make it available to students');
    
    process.exit(0);
  } catch (error) {
    console.error('\nERROR:', error.message);
    console.error(error);
    process.exit(1);
  }
}

seedMalawisPizza();
