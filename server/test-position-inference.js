/**
 * Test script for AI position inference
 *
 * Usage: node server/test-position-inference.js
 */

import { inferPositionFromTranscript } from './services/positionInference.js';

// Sample transcript where student argues FOR quick service
const sampleTranscriptFor = `
Student: I think we should definitely implement the quick service model. The data shows customer satisfaction increases by 15% with faster service times.

CEO: What about the training costs? That seems like a significant investment.

Student: Yes, but the ROI is clear. Within 6 months, we'll recoup those costs through increased customer retention and higher transaction volumes. The quick service model is proven in similar markets.

CEO: Have you considered the impact on employee morale?

Student: Actually, studies show employees prefer the quick service model because it reduces downtime and makes their work more efficient. I believe the benefits far outweigh the costs, and we should move forward with implementation.
`;

// Sample transcript where student argues AGAINST quick service
const sampleTranscriptAgainst = `
Student: I'm concerned about rushing into the quick service model. While it sounds appealing, there are significant risks we need to consider.

CEO: What risks do you see?

Student: First, the training costs are substantial and there's no guarantee of success. Second, our brand is built on quality service, not speed. We risk alienating our loyal customer base who value the personal attention we currently provide.

CEO: But the data shows customers want faster service.

Student: That data is from a different market segment. Our customers prioritize quality over speed. I think we should focus on improving our current model rather than adopting quick service. The risks of this change are too high, and we could damage what makes us unique.
`;

// Sample case data
const caseData = {
  case_title: 'Quick Service Restaurant Decision',
  chat_question: 'Should we implement the quick service model?',
  arguments_for: 'Increased efficiency, higher customer satisfaction, proven ROI in similar markets',
  arguments_against: 'High training costs, potential quality concerns, risk to brand identity'
};

const positionOptions = ['for quick service', 'against quick service'];
const modelId = 'gpt-4o-mini'; // Use a fast, inexpensive model for testing

async function runTests() {
  console.log('='.repeat(80));
  console.log('Testing AI Position Inference');
  console.log('='.repeat(80));

  // Test 1: Transcript arguing FOR
  console.log('\n--- Test 1: Transcript arguing FOR quick service ---');
  try {
    const result1 = await inferPositionFromTranscript(
      sampleTranscriptFor,
      caseData,
      positionOptions,
      modelId
    );

    if (result1) {
      console.log('✓ Inference succeeded');
      console.log(`  Position: ${result1.position}`);
      console.log(`  Confidence: ${result1.confidence.toFixed(2)}`);
      console.log(`  Reasoning: ${result1.reasoning}`);

      if (result1.position === 'for quick service') {
        console.log('✓ Correctly identified FOR position');
      } else {
        console.log(`✗ Expected "for quick service" but got "${result1.position}"`);
      }
    } else {
      console.log('✗ Inference returned null');
    }
  } catch (error) {
    console.error('✗ Test 1 failed:', error.message);
  }

  // Test 2: Transcript arguing AGAINST
  console.log('\n--- Test 2: Transcript arguing AGAINST quick service ---');
  try {
    const result2 = await inferPositionFromTranscript(
      sampleTranscriptAgainst,
      caseData,
      positionOptions,
      modelId
    );

    if (result2) {
      console.log('✓ Inference succeeded');
      console.log(`  Position: ${result2.position}`);
      console.log(`  Confidence: ${result2.confidence.toFixed(2)}`);
      console.log(`  Reasoning: ${result2.reasoning}`);

      if (result2.position === 'against quick service') {
        console.log('✓ Correctly identified AGAINST position');
      } else {
        console.log(`✗ Expected "against quick service" but got "${result2.position}"`);
      }
    } else {
      console.log('✗ Inference returned null');
    }
  } catch (error) {
    console.error('✗ Test 2 failed:', error.message);
  }

  // Test 3: Empty transcript
  console.log('\n--- Test 3: Empty transcript (should return null) ---');
  try {
    const result3 = await inferPositionFromTranscript(
      '',
      caseData,
      positionOptions,
      modelId
    );

    if (result3 === null) {
      console.log('✓ Correctly returned null for empty transcript');
    } else {
      console.log('✗ Expected null but got a result');
    }
  } catch (error) {
    console.error('✗ Test 3 failed:', error.message);
  }

  console.log('\n' + '='.repeat(80));
  console.log('Tests complete');
  console.log('='.repeat(80));
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});
