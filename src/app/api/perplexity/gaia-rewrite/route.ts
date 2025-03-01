import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(req: NextRequest) {
  // Default fallback content for error cases
  const fallbackContent = '{"title":"Error","summary":"An error occurred while processing your request.","details":"The system encountered an error while trying to process your request. Please try again.","actionableSteps":["Try your query again","If the problem persists, try a different query"]}';

  let requestContent = '';

  try {
    console.log('Gaia rewrite endpoint called');
    
    const { content } = await req.json();
    requestContent = content;
    
    if (!content) {
      console.error('No content provided to Gaia rewrite endpoint');
      return NextResponse.json({ error: 'No content provided' }, { status: 400 });
    }
    
    console.log('Content received for rewriting, length:', content.length);
    
    // Read the Gaia character file
    let gaiaCharacter;
    try {
      const gaiaFilePath = '/Users/mattdalley/CascadeProjects/GaiaAI/GAIA4CHARACTER.json';
      console.log('Attempting to read Gaia character file from:', gaiaFilePath);
      
      if (!fs.existsSync(gaiaFilePath)) {
        console.error('Gaia character file does not exist at path:', gaiaFilePath);
        return NextResponse.json({ error: 'Gaia character file not found' }, { status: 500 });
      }
      
      const gaiaData = fs.readFileSync(gaiaFilePath, 'utf8');
      gaiaCharacter = JSON.parse(gaiaData);
      console.log('Successfully loaded Gaia character file');
    } catch (error) {
      console.error('Error loading Gaia character file:', error);
      return NextResponse.json({ error: 'Failed to load Gaia character file', message: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    }
    
    // Extract character information from the Gaia character file
    const systemPrompt = gaiaCharacter.system || '';
    const bio = Array.isArray(gaiaCharacter.bio) ? gaiaCharacter.bio.join('\n') : '';
    const style = Array.isArray(gaiaCharacter.style?.all) ? gaiaCharacter.style.all.join('\n') : '';
    const adjectives = Array.isArray(gaiaCharacter.adjectives) ? gaiaCharacter.adjectives.join(', ') : '';
    
    if (!systemPrompt) {
      console.error('No system prompt found in Gaia character file');
      return NextResponse.json({ error: 'No system prompt found in Gaia character file' }, { status: 500 });
    }
    
    // Prepare the prompt for the Sonar API
    const rewritePrompt = `
You are Gaia, an AI with the following character definition:

System: ${systemPrompt}

Bio: ${bio}

Writing style: ${style}

Key qualities: ${adjectives}

I will provide you with a JSON object containing environmental research information. 
Your task is to rewrite the content in your unique voice and style while preserving:
1. The exact JSON structure
2. All factual information
3. All actionable steps
4. All resources and links

Here is the JSON content to rewrite:
${content}

Return ONLY the rewritten JSON object with no additional text, explanations, or markdown formatting.
The response must be valid JSON that can be parsed with JSON.parse().
`;

    console.log('Prepared rewrite prompt, length:', rewritePrompt.length);
    
    // Call the Perplexity Sonar API to rewrite the content
    try {
      const apiKey = process.env.PERPLEXITY_API_KEY || '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';
      
      const requestBody = {
        model: 'sonar',  // Correct model name according to latest Perplexity API docs
        messages: [
          {
            role: 'user',
            content: rewritePrompt
          }
        ],
        max_tokens: 2000
      };
      
      console.log('Calling Perplexity Sonar API');
      
      // Create an AbortController with a timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
      
      // Clear the timeout
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Perplexity Sonar API error:', response.status, errorText);
        return NextResponse.json({ 
          error: 'Error from Perplexity Sonar API', 
          message: errorText, 
          content: requestContent
        }, { status: response.status });
      }
      
      const data = await response.json();
      console.log('Raw Sonar API response received');
      
      if (data.choices && data.choices[0] && data.choices[0].message) {
        const rewrittenContent = data.choices[0].message.content;
        console.log('Rewritten content received, length:', rewrittenContent.length);
        
        // Try to extract and validate the JSON from the response
        try {
          // Clean up the content to extract just the JSON
          let cleanedContent = rewrittenContent.trim();
          
          // Remove markdown code blocks if they exist
          if (cleanedContent.includes('```json')) {
            cleanedContent = cleanedContent.replace(/```json\n|\n```/g, '');
            console.log('Removed markdown code blocks');
          }
          
          // Extract JSON if it's embedded in other text
          const jsonStartIndex = cleanedContent.indexOf('{');
          const jsonEndIndex = cleanedContent.lastIndexOf('}') + 1;
          
          if (jsonStartIndex !== -1 && jsonEndIndex !== -1) {
            cleanedContent = cleanedContent.substring(jsonStartIndex, jsonEndIndex);
            console.log('Extracted JSON content, length:', cleanedContent.length);
          }
          
          // Validate that it's proper JSON by parsing it
          JSON.parse(cleanedContent);
          console.log('Successfully validated rewritten JSON');
          
          // Return the rewritten content
          return NextResponse.json({ content: cleanedContent });
        } catch (e) {
          console.error('Failed to parse rewritten content as JSON:', e);
          console.log('Invalid JSON content:', rewrittenContent);
          
          // Return the original content if we can't parse the rewritten content
          return NextResponse.json({ 
            content: requestContent, 
            error: 'Failed to parse rewritten content as JSON'
          });
        }
      } else {
        console.error('Unexpected Sonar API response structure:', data);
        return NextResponse.json({ 
          content: requestContent, 
          error: 'Unexpected Sonar API response structure' 
        });
      }
    } catch (error: unknown) {
      console.error('Error calling Perplexity Sonar API:', error);
      
      // Check if it's an AbortError (timeout)
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      console.log(isTimeout ? 'Request timed out' : 'Error processing request');
      
      return NextResponse.json({ 
        content: requestContent, // Return the original content which should be valid JSON
        error: isTimeout ? 'Perplexity Sonar API request timed out' : 'Error calling Perplexity Sonar API'
      });
    }
  } catch (error: unknown) {
    console.error('Error in Gaia rewrite endpoint:', error);
    // In case of a critical error, return a valid JSON response with the original content if available
    return NextResponse.json({ 
      error: 'Internal server error in Gaia rewrite endpoint',
      message: error instanceof Error ? error.message : 'Unknown error',
      content: requestContent || fallbackContent
    }, { status: 500 });
  }
}
