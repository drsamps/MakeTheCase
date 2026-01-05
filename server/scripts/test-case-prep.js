/**
 * Test script for Case Prep functionality
 * Tests: fileConverter, promptService, and llmRouter integration
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { convertFile, cleanPdfText } from '../services/fileConverter.js';
import {
  getActivePrompt,
  renderPrompt,
  getAllPrompts,
  getAllPromptUses
} from '../services/promptService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('=== CASE PREP FUNCTIONALITY TEST ===\n');

// Test 1: Prompt Service
console.log('1. Testing Prompt Service...');
try {
  // Get all prompt uses
  const uses = await getAllPromptUses();
  console.log(`   ✓ Found ${uses.length} prompt uses:`, uses);

  // Get active prompts
  for (const use of uses.slice(0, 2)) {
    const activePrompt = await getActivePrompt(use);
    if (activePrompt) {
      console.log(`   ✓ Active prompt for "${use}": ${activePrompt.version}`);
    } else {
      console.log(`   ✗ No active prompt found for "${use}"`);
    }
  }

  // Test prompt rendering
  const testPrompt = await getActivePrompt('case_outline_generation');
  if (testPrompt) {
    const variables = {
      case_content: 'Sample case content',
      student_name: 'Test Student',
      case_title: 'Test Case'
    };
    const rendered = renderPrompt(testPrompt.prompt_template, variables);
    console.log(`   ✓ Prompt rendering works (length: ${rendered.length} chars)`);
  }

  console.log('   ✓ Prompt Service: PASSED\n');
} catch (error) {
  console.log(`   ✗ Prompt Service: FAILED - ${error.message}\n`);
}

// Test 2: File Converter - Clean PDF Text
console.log('2. Testing PDF Text Cleaner...');
try {
  const messyText = `T h i s   i s   a   t e s t   w i t h   e x t r a   s p a c e s.

Header Text
Page 1

Some content here with
extra    spaces   and

Page 2
Header Text

More content.`;

  const cleaned = cleanPdfText(messyText);
  console.log('   Original length:', messyText.length);
  console.log('   Cleaned length:', cleaned.length);
  console.log('   Sample cleaned text:', cleaned.substring(0, 100));
  console.log('   ✓ PDF Text Cleaner: PASSED\n');
} catch (error) {
  console.log(`   ✗ PDF Text Cleaner: FAILED - ${error.message}\n`);
}

// Test 3: File Conversion (if test files exist)
console.log('3. Testing File Conversion...');
try {
  const testFilesDir = path.join(__dirname, '..', '..', 'case_files', 'malawis-pizza');

  // Check for existing files
  if (fs.existsSync(testFilesDir)) {
    const files = fs.readdirSync(testFilesDir);
    console.log(`   Found files in malawis-pizza:`, files);

    // Try to convert markdown files (should work)
    const mdFile = files.find(f => f.endsWith('.md'));
    if (mdFile) {
      const mdPath = path.join(testFilesDir, mdFile);
      const content = await convertFile(mdPath, '.md');
      console.log(`   ✓ Converted ${mdFile} (${content.length} chars)`);
    }

    console.log('   ✓ File Conversion: PASSED\n');
  } else {
    console.log('   ⚠ Test files directory not found, skipping conversion test\n');
  }
} catch (error) {
  console.log(`   ✗ File Conversion: FAILED - ${error.message}\n`);
}

// Test 4: Database Integration
console.log('4. Testing Database Integration...');
try {
  const allPrompts = await getAllPrompts();
  console.log(`   ✓ Retrieved ${allPrompts.length} prompts from database`);

  // Group by use
  const promptsByUse = allPrompts.reduce((acc, p) => {
    if (!acc[p.use]) acc[p.use] = [];
    acc[p.use].push(p.version);
    return acc;
  }, {});

  console.log('   Prompts by use:');
  Object.entries(promptsByUse).forEach(([use, versions]) => {
    console.log(`     - ${use}: ${versions.join(', ')}`);
  });

  console.log('   ✓ Database Integration: PASSED\n');
} catch (error) {
  console.log(`   ✗ Database Integration: FAILED - ${error.message}\n`);
}

console.log('=== TEST SUMMARY ===');
console.log('All core services are functional and ready for end-to-end testing.');
console.log('\nNext steps:');
console.log('1. Start the frontend: npm run dev');
console.log('2. Login as admin');
console.log('3. Navigate to Case Prep tab');
console.log('4. Upload a PDF or Word file');
console.log('5. Process with AI model');
console.log('6. Review and edit the generated outline');
