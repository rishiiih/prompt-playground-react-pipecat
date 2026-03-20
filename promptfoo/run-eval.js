const promptfoo = require('promptfoo');
const fs = require('fs');
require('dotenv').config();

async function runAutomatedTests() {
  console.log("🚀 Starting Automated Zubi Evaluation...");

  const basePrompt = fs.readFileSync('zubi-prompt.txt', 'utf8');
  const finalPrompt = basePrompt + '\n\n=== CONVERSATION HISTORY ===\n{{history}}';

  const results = await promptfoo.evaluate({
    prompts: [finalPrompt], 
    providers: ['openai:gpt-4.1'], 
tests: [
      {
        description: "Rule Check: Indian English Syntax & Image Tool",
        vars: {
          history: "Child: Can you draw a big magical tree for me?"
        },
        assert: [
          // 1. Using a real JS arrow function!
          { type: 'javascript', value: (output) => output.includes('generate_image') },
          { type: 'llm-rubric', value: "The spoken response MUST contain an Indian English syntax pattern like 'no?', 'very-very', or 'only'." }
        ]
      },
      {
        description: "Rule Check: The Hindi Instruction Exception",
        vars: {
          // Added context so Zubi has an activity to explain!
          history: "Zubi: Let's play a game! We are going to draw a magic pet.\nChild: Mujhe current activity ke instructions Hindi mein samjhao."
        },
        assert: [
          // Updated rubric to ignore the English tool-calls
          { type: 'llm-rubric', value: "The spoken conversation intended for the user must be in pure Hindi explaining that they need to draw a magic pet. IMPORTANT: Ignore any system tool calls (like show_text) in the text; tool calls are allowed to be in English." },
          { type: 'not-icontains', value: 'generate_image' } 
        ]
      },
      {
        description: "Rule Check: Activity Completion",
        vars: {
          history: "Child: I am done with the activity! I finished the whole thing."
        },
        assert: [
          // 3. Using a real JS arrow function!
          { type: 'javascript', value: (output) => output.includes('activity_complete') }
        ]
      }
    ]
  });

  console.log("\n✅ Test Run Complete!");
  
  // Updated Scoreboard Logic
  if (results && results.results) {
      const passes = results.results.filter(r => r.success).length;
      const fails = results.results.filter(r => !r.success).length;

      console.log(`Passed: ${passes}`);
      console.log(`Failed: ${fails}`);
      
      if (fails > 0) {
          console.log("\n⚠️ Some tests failed! Here is why:");
          results.results.filter(r => !r.success).forEach((r, idx) => {
              console.log(`- ${r.error}`);
          });
      }
  }
}

runAutomatedTests();