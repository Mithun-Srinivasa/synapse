// gemini.ts -- Gemini 2.5 Flash wrapper for Synapse AI chat
// Phase 5: AI integration layer

import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY;
let genAI: GoogleGenerativeAI | null = null;

if (apiKey) {
  genAI = new GoogleGenerativeAI(apiKey);
  console.log('🤖 [Gemini] Initialized with API key');
} else {
  console.warn('⚠️ [Gemini] No GEMINI_API_KEY found. AI features disabled.');
}

// System prompts
const CHAT_SYSTEM_PROMPT = `You are a collaborative thinking partner on a shared whiteboard. Two or more people are working together on this canvas. Keep responses concise (under 150 words unless asked for more). Be direct and useful. You can see the conversation history above. Do not mention that you are an AI.`;

const GENERATE_SYSTEM_PROMPT = `You are a diagram generator. Return ONLY valid JSON. No prose, no markdown, no code fences. The user wants you to generate a diagram on their collaborative whiteboard.
Return this exact structure:
{
  "nodes": [
    { "id": "string", "type": "box|circle|sticky", "label": "string", "x": number, "y": number, "width": number, "height": number }
  ],
  "edges": [
    { "from": "nodeId", "to": "nodeId", "label": "string (optional)" }
  ]
}
Place nodes starting at x:100 y:100. Space them 200px apart horizontally. Keep labels under 6 words. Maximum 12 nodes per response.`;

export interface ChatHistoryEntry {
  role: 'user' | 'model';
  parts: { text: string }[];
}

/** Check if Gemini is available */
export function isGeminiAvailable(): boolean {
  return genAI !== null;
}

/**
 * Stream a chat response. Yields text chunks as they arrive.
 * @param history - Previous conversation turns (max 10)
 * @param message - Current user message
 */
export async function* streamChatResponse(
  history: ChatHistoryEntry[],
  message: string
): AsyncGenerator<string> {
  if (!genAI) throw new Error('Gemini not initialized');

  // systemInstruction must be passed to getGenerativeModel, not startChat
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.5-flash',
    systemInstruction: CHAT_SYSTEM_PROMPT,
  });
  const chat = model.startChat({ history });

  const result = await chat.sendMessageStream(message);
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}

/**
 * Generate a diagram (non-streaming, accumulates full response for JSON parsing).
 * Returns the raw text response from Gemini.
 */
export async function generateDiagram(
  message: string
): Promise<string> {
  if (!genAI) throw new Error('Gemini not initialized');

  const model = genAI.getGenerativeModel({
    model: 'gemini-3.5-flash',
    systemInstruction: GENERATE_SYSTEM_PROMPT,
  });
  const chat = model.startChat({ history: [] });

  const result = await chat.sendMessage(message);
  return result.response.text();
}
