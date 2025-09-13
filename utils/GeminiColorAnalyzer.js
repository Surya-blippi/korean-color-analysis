// utils/GeminiColorAnalyzer.js - Adapted for Node.js
const fs = require('fs');
const axios = require('axios');

class GeminiColorAnalyzer {
  constructor() {
    this.apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest';
    
    if (!this.apiKey) {
      console.error('Gemini API key not found. Please set NEXT_PUBLIC_GEMINI_API_KEY in your environment variables.');
    }
  }

  async fileToBase64(file) {
    try {
      if (file.arrayBuffer) {
        // Handle File-like objects
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        return buffer.toString('base64');
      } else if (Buffer.isBuffer(file)) {
        // Handle Buffer directly
        return file.toString('base64');
      } else if (typeof file === 'string') {
        // Handle file path
        const buffer = fs.readFileSync(file);
        return buffer.toString('base64');
      } else {
        throw new Error('Unsupported file format');
      }
    } catch (error) {
      console.error('Error converting file to base64:', error);
      throw error;
    }
  }

  async analyzeColors(file, mimeType = 'image/jpeg') {
    if (!this.apiKey) {
      return { success: false, error: 'Gemini API key is not configured.' };
    }

    try {
      const base64Image = await this.fileToBase64(file);
      
      const prompt = `
You are an expert Korean personal color analyst. Your task is to analyze the provided selfie to determine the user's personal color season based on the detailed 12-season system and provide actionable recommendations.

**Analysis Steps:**
1.  **Observe Skin Undertone:** Look for cool (pink, red, blueish), warm (yellow, peachy, golden), or neutral/olive tones.
2.  **Determine Value & Chroma:** Assess the overall lightness/darkness and brightness/softness of their features.
3.  **Synthesize:** Identify the most fitting of the 12 seasons (e.g., True Summer, Warm Autumn, Bright Winter).

**Output Format:**
Respond with a single, valid JSON object only. Do not include any markdown formatting, comments, or surrounding text.

**JSON Structure:**
{
  "personal_profile": {
    "season": "Your determined 12-season classification (e.g., 'Soft Autumn')",
    "undertone": "A brief description of the undertone (e.g., 'Warm with golden hues')",
    "summary": "An empowering and descriptive 2-3 sentence summary of their color profile."
  },
  "color_palettes": {
    "key_colors": [ { "name": "Color Name", "hex": "#HEXCODE", "description": "Why this is a great color." } ],
    "neutrals": [ { "name": "Color Name", "hex": "#HEXCODE", "description": "How to use this neutral." } ],
    "accent_colors": [ { "name": "Color Name", "hex": "#HEXCODE", "description": "Best for accessories." } ]
  },
  "recommendations": {
    "makeup": {
      "vibe": "A short description of the ideal makeup style (e.g., 'Soft, natural, and warm').",
      "foundation": "Tip for finding the right foundation undertone.",
      "blush": "Recommended blush colors and tones.",
      "eyeshadow": "Recommended eyeshadow colors and tones.",
      "lipstick": "Recommended lipstick colors and tones."
    },
    "hair_colors": [
      "Recommended Hair Color 1",
      "Recommended Hair Color 2",
      "Recommended Hair Color 3"
    ],
    "style": {
      "jewelry": "Recommendation for metal tones (e.g., 'Silver and platinum are best. Avoid yellow gold.').",
      "fabrics": "Advice on suitable fabric types and textures.",
      "patterns": "Advice on suitable print and pattern styles (e.g., 'Low-contrast, delicate florals')."
    }
  },
  "colors_to_avoid": [
    { "name": "Color Name", "hex": "#HEXCODE" }
  ]
}

**Important Constraints:**
- Provide 6 'key_colors', 4 'neutrals', and 2 'accent_colors'.
- Provide 3-4 'hair_colors'.
- Provide 4 'colors_to_avoid'.
- Ensure all hex codes are valid. Before responding, double-check that your output is a single, complete JSON object with all specified keys.
`;

      const requestBody = {
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64Image } }
          ]
        }],
        generationConfig: {
          response_mime_type: "application/json",
          temperature: 0.4,
          topP: 0.95,
          topK: 40,
        }
      };

      const response = await axios.post(
        `${this.baseUrl}:generateContent?key=${this.apiKey}`, 
        requestBody,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 60000 // 60 second timeout
        }
      );

      if (response.status !== 200) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data = response.data;
      
      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        throw new Error('Invalid response format from Gemini API');
      }

      const jsonString = data.candidates[0].content.parts[0].text;
      
      let analysisData;
      try {
        analysisData = JSON.parse(jsonString);
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
        console.error('Raw response:', jsonString);
        throw new Error('Failed to parse analysis results');
      }

      // Validate the analysis structure
      if (!this.validateAnalysis(analysisData)) {
        throw new Error('Analysis results are incomplete or invalid');
      }

      return { success: true, analysis: analysisData };

    } catch (error) {
      console.error('Color analysis error:', error);
      
      if (error.code === 'ECONNABORTED') {
        return { success: false, error: 'Analysis timed out. Please try with a smaller image.' };
      }
      
      if (error.response?.status === 429) {
        return { success: false, error: 'Too many requests. Please try again in a few moments.' };
      }
      
      if (error.response?.status === 400) {
        return { success: false, error: 'Invalid image format. Please try with a clear JPEG or PNG image.' };
      }

      return { 
        success: false, 
        error: error.message || 'An unknown error occurred during analysis. Please try again.' 
      };
    }
  }

  validateAnalysis(analysis) {
    try {
      // Check basic structure
      if (!analysis || typeof analysis !== 'object') return false;
      
      // Check personal_profile
      if (!analysis.personal_profile || 
          !analysis.personal_profile.season || 
          !analysis.personal_profile.undertone || 
          !analysis.personal_profile.summary) {
        return false;
      }

      // Check color_palettes
      if (!analysis.color_palettes || 
          !Array.isArray(analysis.color_palettes.key_colors) ||
          !Array.isArray(analysis.color_palettes.neutrals) ||
          !Array.isArray(analysis.color_palettes.accent_colors)) {
        return false;
      }

      // Check recommendations
      if (!analysis.recommendations ||
          !analysis.recommendations.makeup ||
          !Array.isArray(analysis.recommendations.hair_colors) ||
          !analysis.recommendations.style) {
        return false;
      }

      // Check colors_to_avoid
      if (!Array.isArray(analysis.colors_to_avoid)) {
        return false;
      }

      return true;
    } catch (error) {
      console.error('Validation error:', error);
      return false;
    }
  }

  validateImage(file, maxSize = 5 * 1024 * 1024) {
    try {
      if (!file) {
        return { valid: false, error: 'No file provided.' };
      }

      // Check file size
      if (file.size && file.size > maxSize) {
        return { valid: false, error: 'Image file size should be less than 5MB.' };
      }

      // Check file type if available
      if (file.type) {
        const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!validTypes.includes(file.type)) {
          return { valid: false, error: 'Please upload a valid image file (JPEG, PNG, or WebP).' };
        }
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: 'Failed to validate image.' };
    }
  }

  // Helper method for WhatsApp media
  async analyzeFromBuffer(imageBuffer, mimeType = 'image/jpeg') {
    const validation = this.validateImage({ size: imageBuffer.length, type: mimeType });
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    return this.analyzeColors(imageBuffer, mimeType);
  }
}

module.exports = GeminiColorAnalyzer;